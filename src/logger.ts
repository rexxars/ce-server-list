import pino from 'pino'
import {config} from './config'

export const log = pino({level: config.logLevel})
