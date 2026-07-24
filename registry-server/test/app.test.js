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

  const landingPage = await fetch(base)
  assert.equal(landingPage.status, 200)
  assert.match(landingPage.headers.get('content-type'), /^text\/html/)
  const landingPageHtml = await landingPage.text()
  assert.match(landingPageHtml, /Keep the thread/)
  assert.match(landingPageHtml, /\/site\.css\?v=20260724-1/)
  assert.match(landingPageHtml, /\/site\.js\?v=20260724-1/)
  assert.match(landingPage.headers.get('content-security-policy'), /script-src 'self'/)

  const stylesheet = await fetch(`${base}/site.css?v=20260724-1`)
  assert.equal(stylesheet.status, 200)
  assert.match(stylesheet.headers.get('content-type'), /^text\/css/)
  assert.equal(stylesheet.headers.get('cache-control'), 'no-cache')
  assert.match(await stylesheet.text(), /--orange: #f05a2a/)

  const script = await fetch(`${base}/site.js?v=20260724-1`)
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type'), /^text\/javascript/)
  assert.equal(script.headers.get('cache-control'), 'no-cache')

  const browserNotFound = await fetch(`${base}/missing-page`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  })
  assert.equal(browserNotFound.status, 404)
  assert.match(browserNotFound.headers.get('content-type'), /^text\/html/)
  assert.match(await browserNotFound.text(), /404 · Route not found/)

  const apiNotFound = await fetch(`${base}/v1/missing`, {
    headers: { accept: 'text/html,application/json' },
  })
  assert.equal(apiNotFound.status, 404)
  assert.match(apiNotFound.headers.get('content-type'), /^application\/json/)
  assert.deepEqual(Object.keys((await apiNotFound.json()).error).sort(), ['code', 'message', 'requestId'])

  const wrongMethod = await fetch(`${base}/healthz`, { method: 'POST' })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET')
  assert.equal((await wrongMethod.json()).error.code, 'method_not_allowed')

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
