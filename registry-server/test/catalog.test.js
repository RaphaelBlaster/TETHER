import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'

import { createRegistryCatalog } from '../src/catalog.js'
import { createRegistryDatabase } from '../src/database.js'
import { createOperationalStore } from '../src/operational-store.js'

test('catalog verifies the Git-published index and provider checksum', async () => {
  const database = createRegistryDatabase({ path: ':memory:' })
  const cache = await createOperationalStore()
  const catalog = createRegistryCatalog({
    root: resolve('..', 'provider-adapters'),
    cache,
    database,
  })

  const index = await catalog.loadIndex()
  assert.equal(index.index.schemaVersion, 1)
  const provider = await catalog.manifestForOrigin('https://tinker.thinkingmachines.ai')
  assert.equal(provider.manifest.origin, 'https://tinker.thinkingmachines.ai')
  assert.match(provider.etag, /^"[a-f0-9]{64}"$/)
  assert.equal(await catalog.manifestForOrigin('https://unknown.example'), null)
  database.close()
})
