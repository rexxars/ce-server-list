import http from 'node:http'
import path from 'node:path'
import {readFile} from 'node:fs/promises'

import {log} from './logger.ts'
import {sortByKey} from './serverlist.ts'
import type {Server} from './typings.ts'

const STATIC_DIR = path.join(import.meta.dirname, '..', 'static')

// Transparent 1x1 SVG used when a server has no known country. Mirrors the value
// in static/servers.js so the server-rendered markup matches the live updates.
const EMPTY_FLAG =
  'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIHN0eWxlPSJmaWxsOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDApOyI+PC9yZWN0Pjwvc3ZnPg=='

// Hardcoded content types for the handful of file extensions we serve - keeps
// the static server dependency-free.
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.exe': 'application/octet-stream',
}

// Allow-list of static assets we are willing to serve, guarding against path
// traversal: only these exact filenames map to a file on disk.
const STATIC_FILES = new Set([
  'styles.css',
  'servers.js',
  'favicon.ico',
  'ce-master-patch.exe',
])

// Cache-Control policies. Dynamic responses get a short TTL so updates surface
// quickly; the favicon effectively never changes so it can be cached for a year;
// versioned assets (JS/CSS) revalidate against an ETag on every request.
const SHORT_TTL = 'public, max-age=5'
const IMMUTABLE_TTL = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

export interface HttpServerOptions {
  /** Returns the current in-memory list of online servers. */
  getServers: () => Server[]
}

/**
 * Builds the public-facing HTTP server using only Node built-ins:
 *
 * - `GET /` renders the server list from the current in-memory state.
 * - `GET /help` serves the "host your own server" guide.
 * - `GET /iplist.txt` lists the IPs of all known online servers.
 * - `GET /styles.css|/servers.js|/favicon.ico|/ce-master-patch.exe` serves the
 *   static assets.
 *
 * The `/api` endpoint is intentionally not exposed; the frontend reads live
 * updates directly from Sanity's listen endpoint instead.
 */
export function createHttpServer(options: HttpServerOptions): http.Server {
  const {getServers} = options

  // HTML pages are read once and cached by filename. `/` injects dynamic rows
  // into its template on each request; `/help` is served verbatim.
  const htmlCache = new Map<string, Promise<string>>()
  const loadHtml = (name: string) =>
    htmlCache.get(name) ?? htmlCache.set(name, readFile(path.join(STATIC_DIR, name), 'utf8')).get(name)!

  // Static assets are read, fingerprinted and cached once on first request.
  const staticCache = new Map<string, Promise<StaticAsset>>()
  const loadStatic = (name: string) =>
    staticCache.get(name) ?? staticCache.set(name, readStatic(name)).get(name)!

  return http.createServer((req, res) => {
    handleRequest(req, res, getServers, loadHtml, loadStatic).catch((err) => {
      log.warn('HTTP request failed: %s', err instanceof Error ? err.message : String(err))
      if (!res.headersSent) {
        send(req, res, 500, 'text/plain; charset=utf-8', 'Internal Server Error\n', REVALIDATE)
      } else {
        res.end()
      }
    })
  })
}

interface StaticAsset {
  body: Buffer
  contentType: string
  etag: string
}

async function readStatic(name: string): Promise<StaticAsset> {
  const body = await readFile(path.join(STATIC_DIR, name))
  const contentType = MIME_TYPES[path.extname(name)] ?? 'application/octet-stream'
  const digest = await crypto.subtle.digest('SHA-256', body)
  const etag = `"${Buffer.from(digest).toString('hex').slice(0, 16)}"`
  return {body, contentType, etag}
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  getServers: () => Server[],
  loadHtml: (name: string) => Promise<string>,
  loadStatic: (name: string) => Promise<StaticAsset>,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed\n', REVALIDATE)
    return
  }

  const {pathname} = new URL(req.url ?? '/', 'http://localhost')

  if (pathname === '/') {
    const html = renderIndex(await loadHtml('index.html'), sortByKey(getServers()))
    send(req, res, 200, 'text/html; charset=utf-8', html, SHORT_TTL)
    return
  }

  if (pathname === '/help') {
    send(req, res, 200, 'text/html; charset=utf-8', await loadHtml('help.html'), SHORT_TTL)
    return
  }

  if (pathname === '/iplist.txt') {
    send(
      req,
      res,
      200,
      'text/plain; charset=utf-8',
      renderIpList(sortByKey(getServers())),
      SHORT_TTL,
    )
    return
  }

  const name = pathname.slice(1)
  if (STATIC_FILES.has(name)) {
    const {body, contentType, etag} = await loadStatic(name)

    // The favicon effectively never changes, so cache it aggressively.
    if (name === 'favicon.ico') {
      send(req, res, 200, contentType, body, IMMUTABLE_TTL)
      return
    }

    // JS/CSS/the patch binary revalidate against the ETag: reply 304 when the
    // client's copy matches.
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {etag, 'cache-control': REVALIDATE})
      res.end()
      return
    }

    // Force the patch binary to download rather than letting the browser try to
    // navigate to it. The URL basename is already the right filename.
    const extraHeaders =
      name === 'ce-master-patch.exe' ? {'content-disposition': 'attachment'} : undefined
    send(req, res, 200, contentType, body, REVALIDATE, etag, extraHeaders)
    return
  }

  send(req, res, 404, 'text/plain; charset=utf-8', 'Not Found\n', REVALIDATE)
}

function renderIndex(template: string, servers: Server[]): string {
  const rows = servers.length
    ? servers.map(renderRow).join('\n')
    : '<tr><td colspan="7" class="empty">No servers online.</td></tr>'
  return template.replace('<!--SERVER_ROWS-->', rows)
}

function renderRow(server: Server): string {
  const address = `${server.ip}:${server.serverPort}`
  const mode = server.gameType === 'ctf' ? 'CTF' : server.gameType
  return [
    '<tr>',
    `<td class="flag"><img src="${flagSrc(server.countryCode)}" /></td>`,
    `<td>${escapeHtml(server.name)}</td>`,
    `<td><a href="cneagle://${escapeHtml(address)}" rel="noreferrer noopener">${escapeHtml(address)}</a></td>`,
    `<td>${server.numPlayers} / ${server.maxPlayers}</td>`,
    `<td class="map">${escapeHtml(server.map)}</td>`,
    `<td class="mode">${escapeHtml(mode)}</td>`,
    `<td class="version">${escapeHtml(server.version)}</td>`,
    '</tr>',
  ].join('')
}

function flagSrc(countryCode: string | undefined): string {
  return countryCode && /^[a-z]{2}$/i.test(countryCode)
    ? `https://flagcdn.com/${countryCode.toLowerCase()}.svg`
    : EMPTY_FLAG
}

function renderIpList(servers: Server[]): string {
  const ips: string[] = []
  const seen = new Set<string>()
  for (const {ip} of servers) {
    if (!seen.has(ip)) {
      seen.add(ip)
      ips.push(ip)
    }
  }

  return ['# List of online Codename Eagle servers', ...ips, ''].join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  cacheControl: string,
  etag?: string,
  extraHeaders?: http.OutgoingHttpHeaders,
): void {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const headers: http.OutgoingHttpHeaders = {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': cacheControl,
    ...extraHeaders,
  }
  if (etag) {
    headers.etag = etag
  }
  res.writeHead(status, headers)
  res.end(req.method === 'HEAD' ? undefined : buffer)
}
