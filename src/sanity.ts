import {createClient} from '@sanity/client'
import {config} from './config.ts'

export const sanityClient = createClient({
  projectId: 'cenation',
  dataset: 'servers',
  useCdn: false,
  token: config.sanityToken,
  apiVersion: '2025-01-01',
})
