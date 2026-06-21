import {diffValue, type SanityPatchOperations} from '@sanity/diff-patch'

import type {SyncChangeset} from './sanitySync.ts'

export interface ServerListMutations {
  createIfNotExists: {_id: string; _type: string; servers: never[]}
  /** Patch operations to apply, in order, to the `serverList` document. */
  patches: SanityPatchOperations[]
}

export interface MutationOptions {
  documentId: string
  documentType: string
}

function keySelector(key: string): string {
  return `servers[_key=="${key}"]`
}

/**
 * Translates a {@link SyncChangeset} into the Sanity patch operations needed to
 * apply it to the single `serverList` document. Updates are diffed field-by-field
 * against their last-synced state via `@sanity/diff-patch` so only what actually
 * changed is written (e.g. a single player's `frags`), inserts become one append,
 * and removals key-targeted `unset`s. `createIfNotExists` (with an empty array)
 * guarantees the document and `servers` array exist before the patches apply.
 */
export function buildServerListMutations(
  {updates, inserts, removals}: SyncChangeset,
  {documentId, documentType}: MutationOptions,
): ServerListMutations {
  const patches: SanityPatchOperations[] = []

  for (const {previous, next} of updates) {
    patches.push(...diffValue(previous, next, ['servers', {_key: next._key}]))
  }

  if (inserts.length > 0) {
    patches.push({insert: {after: 'servers[-1]', items: inserts}})
  }

  if (removals.length > 0) {
    patches.push({unset: removals.map(keySelector)})
  }

  return {
    createIfNotExists: {_id: documentId, _type: documentType, servers: []},
    patches,
  }
}
