import {createClient} from '@sanity/client'
import {config} from './config.ts'
import {buildServerListMutations} from './sanityMutations.ts'
import type {SyncChangeset} from './sanitySync.ts'
import type {ServerList} from './typings.ts'

export const SERVER_LIST_ID = 'serverList'
export const SERVER_LIST_TYPE = 'serverList'

export const sanityClient = createClient({
  projectId: 'cneagle',
  dataset: 'servers',
  useCdn: false,
  token: config.sanityToken,
  apiVersion: '2025-01-01',
})

/** Reads the persisted server list document, or `null` if it does not exist. */
export function fetchServerList(): Promise<ServerList | null> {
  return sanityClient.fetch<ServerList | null>('*[_id == $id][0]', {id: SERVER_LIST_ID})
}

/**
 * Applies a {@link SyncChangeset} to the `serverList` document as a single
 * transaction: it ensures the document exists, then patches the `servers`
 * array by `_key` (set/unset) and appends new servers.
 */
export function commitChangeset(changeset: SyncChangeset): Promise<void> {
  const {createIfNotExists, patches} = buildServerListMutations(changeset, {
    documentId: SERVER_LIST_ID,
    documentType: SERVER_LIST_TYPE,
  })

  let transaction = sanityClient.transaction().createIfNotExists(createIfNotExists)
  for (const patch of patches) {
    transaction = transaction.patch(SERVER_LIST_ID, patch)
  }

  return transaction.commit({visibility: 'async', returnDocuments: false}).then(() => undefined)
}
