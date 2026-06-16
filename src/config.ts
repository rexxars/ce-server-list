import {join} from 'node:path'
import {homedir} from 'node:os'
import {readFile} from 'node:fs/promises'

import type {Config} from './typings.ts'

export const config: Config = {
  port: parseInt(process.env.CE_SERVER_LIST_PORT || '', 10) || 27900,
  host: process.env.CE_SERVER_LIST_HOST || '0.0.0.0',
  logLevel: process.env.CE_SERVER_LIST_LOG_LEVEL || 'info',
  checkThresholdMs: parseInt(process.env.CE_SERVER_LIST_CHECK_THRESHOLD || '', 10) || 30000,
  sanityToken: process.env.CE_SERVER_LIST_SANITY_TOKEN || (await tryReadSanityConfigToken()) || '',
  httpPort: parseInt(process.env.CE_SERVER_LIST_HTTP_PORT || '', 10) || 8080,
}

function tryReadSanityConfigToken() {
  const configPath = join(homedir(), '.config', 'sanity', 'config.json')
  return readFile(configPath, 'utf-8')
    .then((data) => JSON.parse(data))
    .catch(() => ({}))
    .then((config) => config.authToken)
}
