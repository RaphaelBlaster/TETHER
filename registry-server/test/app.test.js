import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'

import { createRegistryServer } from '../src/app.js'
import { createRegistryCatalog } from '../src/catalog.js'
import { createRegistryDatabase } from '../src/database.js'
import { createOperationalStore } from '../src/operational-store.js'

test('registry serves conditional manifests and accepts bounded drift reports', async (t) => {
  const database = createRegistryDatabase({ path: ':memory:' })
  const operationalStore = await createOperationalStore()
  const catalog = createRegistryCatalog({
    root: resolve('..', 'provider-adapters'),
    cache: operationalStore,
    database,
  })
  const config = {
    host: '127.0.0.1',
    port: 0,
    trustProxy: false,
    rateLimit: 10,
    rateWindowSeconds: 60,
    dedupeSeconds: 300,
    maintenanceThreshold: 1,
    rateLimitSalt: 'test',
    maxRequestBytes: 2048,
  }
  const server = createRegistryServer({ config, database, operationalStore, catalog })
  const address = await server.start()
  t.after(async () => {
    await server.stop()
    await operationalStore.close()
    database.close()
  })
  const base = `http://${address.host}:${address.port}`

  const manifestResponse = await fetch(
    `${base}/v1/adapters?origin=${encodeURIComponent('https://tinker.thinkingmachines.ai')}`,
  )
  assert.equal(manifestResponse.status, 200)
  assert.equal((await manifestResponse.json()).origin, 'https://tinker.thinkingmachines.ai')
  const etag = manifestResponse.headers.get('etag')

  const unchanged = await fetch(
    `${base}/v1/adapters?origin=${encodeURIComponent('https://tinker.thinkingmachines.ai')}`,
    { headers: { 'If-None-Match': etag } },
  )
  assert.equal(unchanged.status, 304)

  const drift = await fetch(`${base}/v1/drift-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: 'https://tinker.thinkingmachines.ai',
      adapterVersion: 1,
      extensionVersion: '0.1.0',
      errorCode: 'assistant_selector_missing',
    }),
  })
  assert.equal(drift.status, 202)
  assert.deepEqual(await drift.json(), {
    accepted: true,
    reportCount: 1,
    maintenanceQueued: true,
  })

  const duplicate = await fetch(`${base}/v1/drift-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: 'https://tinker.thinkingmachines.ai',
      adapterVersion: 1,
      extensionVersion: '0.1.0',
      errorCode: 'assistant_selector_missing',
    }),
  })
  assert.equal(duplicate.status, 202)
  assert.deepEqual(await duplicate.json(), { accepted: false, duplicate: true })

  const unknownCode = await fetch(`${base}/v1/drift-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: 'https://tinker.thinkingmachines.ai',
      adapterVersion: 1,
      extensionVersion: '0.1.0',
      errorCode: 'arbitrary_category',
    }),
  })
  assert.equal(unknownCode.status, 400)
})
