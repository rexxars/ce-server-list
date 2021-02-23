import path from 'path'
import express, {Express} from 'express'
import {Server} from './typings'

export function getHttpServer(servers: Server[], state: {lastPingAt: number}): Express {
  const app = express()
  app.disable('etag')
  app.disable('x-powered-by')
  app.use(
    express.static(path.join(__dirname, '..', 'static'), {
      maxAge: 0,
      cacheControl: false,
      etag: false,
    })
  )
  app.use(
    '/flags',
    express.static(path.join(__dirname, '..', 'node_modules', 'svg-country-flags', 'svg'), {
      immutable: true,
    })
  )
  app.get('/api', (_, res) =>
    res.set('cache-control', 'max-age=15').json({lastPingAt: state.lastPingAt, servers})
  )
  return app
}
