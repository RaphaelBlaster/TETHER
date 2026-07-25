import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateXposeApiToken } from '../lib/xpose-api-token.js'
import { startTetherXpose } from '../lib/xpose-launcher.js'
import { createExtensionPairingAuthenticator } from '../lib/xpose-pairing.js'

const EXTENSION_ORIGIN = `chrome-extension://${'a'.repeat(32)}`

test('XposE creates one private API key, reuses it, and rotates only on request', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-token-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state', 'xpose-api-token')
  const generated = ['a'.repeat(43), 'b'.repeat(43)]
  const generateToken = () => generated.shift()

  const first = await loadOrCreateXposeApiToken({ path, generateToken })
  const second = await loadOrCreateXposeApiToken({ path, generateToken })
  const rotated = await loadOrCreateXposeApiToken({ path, rotate: true, generateToken })
  const afterRotation = await loadOrCreateXposeApiToken({ path, generateToken })

  assert.deepEqual(first, { token: 'a'.repeat(43), created: true, rotated: false })
  assert.deepEqual(second, { token: 'a'.repeat(43), created: false, rotated: false })
  assert.deepEqual(rotated, { token: 'b'.repeat(43), created: false, rotated: true })
  assert.deepEqual(afterRotation, { token: 'b'.repeat(43), created: false, rotated: false })
  assert.equal(await readFile(path, 'utf8'), `${'b'.repeat(43)}\n`)
})

test('XposE refuses a malformed stored API key instead of silently replacing it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-invalid-token-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'xpose-api-token')
  await writeFile(path, 'not-a-valid-key\n')

  await assert.rejects(
    loadOrCreateXposeApiToken({ path }),
    { code: 'invalid_xpose_api_key' },
  )
})

test('extension pairing trusts one Chrome extension secret and stores only its hash', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-pairing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'pairing.json')
  const authenticate = createExtensionPairingAuthenticator({ path })
  const hello = {
    extensionInstanceId: 'extension-1',
    pairingToken: 'a'.repeat(43),
    origin: EXTENSION_ORIGIN,
  }
  assert.deepEqual(await authenticate(hello), { paired: true, firstPairing: true })
  assert.deepEqual(await authenticate(hello), { paired: true, firstPairing: false })
  const storedText = await readFile(path, 'utf8')
  const stored = JSON.parse(storedText)
  assert.equal(stored.extensionInstanceId, 'extension-1')
  assert.equal(stored.origin, EXTENSION_ORIGIN)
  assert.match(stored.tokenSha256, /^[a-f0-9]{64}$/)
  assert.equal(storedText.includes(hello.pairingToken), false)
  await assert.rejects(() => authenticate({ ...hello, pairingToken: 'b'.repeat(43) }), {
    code: 'extension_pairing_mismatch',
  })
  await assert.rejects(() => authenticate({ ...hello, origin: 'https://example.com' }), {
    code: 'invalid_extension_origin',
  })
})

test('first-pairing requests are serialized so a racing secret cannot replace trust', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-pairing-race-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const authenticate = createExtensionPairingAuthenticator({ path: join(directory, 'pairing.json') })
  const first = authenticate({
    extensionInstanceId: 'extension-1',
    pairingToken: 'a'.repeat(43),
    origin: EXTENSION_ORIGIN,
  })
  const racing = authenticate({
    extensionInstanceId: 'extension-2',
    pairingToken: 'b'.repeat(43),
    origin: EXTENSION_ORIGIN,
  })
  assert.equal((await first).firstPairing, true)
  await assert.rejects(racing, { code: 'extension_pairing_mismatch' })
})

test('XposE launcher configures a local server without request capture', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-launcher-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let configuration
  let stopped = false
  const instance = await startTetherXpose({
    stateRoot: directory,
    port: 43210,
    apiToken: 'x'.repeat(43),
    createAdapter(options) {
      configuration = options
      return {
        async start() {
          return { host: options.host, port: options.port, baseUrl: `http://${options.host}:${options.port}/v1` }
        },
        async stop() { stopped = true },
      }
    },
  })
  assert.equal(instance.info.baseUrl, 'http://127.0.0.1:43210/v1')
  assert.equal(instance.modelId, 'tether-browser')
  assert.equal(configuration.host, '127.0.0.1')
  assert.equal(configuration.capturePath, undefined)
  assert.equal(configuration.routeResponsesToBrowser, true)
  assert.equal(configuration.xpose.maxConcurrentTurns, 1)
  assert.equal(typeof configuration.xpose.authenticateExtension, 'function')
  await instance.stop()
  assert.equal(stopped, true)
})
