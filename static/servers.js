/* eslint-env browser */
;(function () {
  // Transparent 1x1 SVG used when a server has no known country.
  const empty =
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIHN0eWxlPSJmaWxsOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDApOyI+PC9yZWN0Pjwvc3ZnPg=='

  // Sanity listen endpoint for the `serverList` document. The page is rendered
  // server-side with the current state; this stream keeps it live by pushing the
  // full document on every mutation.
  const listenUrl =
    'https://cneagle.api.sanity.io/v2026-06-03/data/listen/servers' +
    '?query=' +
    encodeURIComponent('*[_id=="serverList"]') +
    '&includeResult=true&includePreviousRevision=false&includeMutations=false'

  // Maximum number of characters shown for a server name (kept in sync with the
  // `MAX_NAME_LENGTH` constant in `src/http.ts`).
  const MAX_NAME_LENGTH = 25

  const tbody = document.querySelector('tbody')

  const source = new EventSource(listenUrl)
  source.addEventListener('mutation', (event) => {
    let servers
    try {
      servers = JSON.parse(event.data).result.servers
    } catch (err) {
      return
    }

    if (Array.isArray(servers)) {
      renderServers(servers)
    }
  })

  function renderServers(servers) {
    // Sort by `_key` so the order is stable and rows do not shuffle around.
    const sorted = servers.slice().sort((a, b) => a._key.localeCompare(b._key))

    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild)
    }

    if (sorted.length === 0) {
      const tr = document.createElement('tr')
      const td = cell('No servers online.', 'empty')
      td.setAttribute('colspan', '6')
      tr.appendChild(td)
      tbody.appendChild(tr)
      return
    }

    sorted.forEach(renderServer)
  }

  function renderServer(server) {
    const {ip, serverPort, version, name, map, maxPlayers, numPlayers, gameType, countryCode} =
      server
    const address = `${ip}:${serverPort}`

    const tr = document.createElement('tr')
    tr.appendChild(nameCell(countryCode, address, name))
    tr.appendChild(cell(address, 'ip'))
    tr.appendChild(cell(`${numPlayers} / ${maxPlayers}`))
    tr.appendChild(cell(map, 'map'))
    tr.appendChild(cell(gameType === 'ctf' ? 'CTF' : gameType, 'mode'))
    tr.appendChild(cell(version, 'version'))

    tbody.appendChild(tr)
  }

  // Name cell holds the country flag and the (truncated) server name, which
  // doubles as the game-join link. Mirrors `renderRow` in `src/http.ts`.
  function nameCell(countryCode, address, name) {
    const td = document.createElement('td')
    td.setAttribute('class', 'name')
    td.appendChild(flag(countryCode))
    td.appendChild(gameLink(address, truncate(name, MAX_NAME_LENGTH)))
    return td
  }

  function flag(countryCode) {
    const src = /^[a-z]{2}$/i.test(countryCode || '')
      ? `https://flagcdn.com/${countryCode.toLowerCase()}.svg`
      : empty
    const img = document.createElement('img')
    img.setAttribute('class', 'flag')
    img.setAttribute('src', src)
    img.setAttribute('alt', '')
    return img
  }

  function gameLink(address, text) {
    const a = document.createElement('a')
    a.setAttribute('href', `cneagle://${address}`)
    a.setAttribute('rel', 'noreferrer noopener')
    a.appendChild(document.createTextNode(text))
    return a
  }

  function truncate(value, max) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value
  }

  function cell(content, className) {
    const td = document.createElement('td')
    if (className) {
      td.setAttribute('class', className)
    }

    if (typeof content === 'string') {
      td.appendChild(document.createTextNode(content))
    } else {
      td.appendChild(content)
    }
    return td
  }
})()
