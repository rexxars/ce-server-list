/* eslint-disable no-process-env */
import {Config} from './typings'

export const config: Config = {
  port: parseInt(process.env.CE_SERVER_LIST_PORT || '', 10) || 27900,
  host: process.env.CE_SERVER_LIST_HOST || '0.0.0.0',
  logLevel: process.env.CE_SERVER_LIST_LOG_LEVEL || 'info',
  checkThresholdMs: parseInt(process.env.CE_SERVER_LIST_CHECK_THRESHOLD || '', 10) || 30000,
  sanityToken: process.env.CE_SERVER_LIST_SANITY_TOKEN || '',
  httpPort: parseInt(process.env.CE_SERVER_LIST_HTTP_PORT || '', 10) || 8080,
}
