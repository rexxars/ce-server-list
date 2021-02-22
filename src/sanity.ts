import SanityClient from '@sanity/client'
import {config} from './config'

export const sanityClient = new SanityClient({
  projectId: 'cenation',
  dataset: 'servers',
  useCdn: false,
  token: config.sanityToken,
})
