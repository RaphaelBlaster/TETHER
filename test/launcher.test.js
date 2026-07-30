import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PORT, extensionPath, runTetherCli } from '../lib/launcher.js'

test('launcher exposes only the XposE port and packaged extension path', () => {
  assert.equal(DEFAULT_PORT, 8766)
  assert.match(extensionPath(), /extension[\\/]dist$/)
})

test('launcher rejects removed Codex entry points', async () => {
  await assert.rejects(
    runTetherCli([]),
    /Use "tether xpose"/,
  )
  await assert.rejects(
    runTetherCli(['launch', 'codex-app']),
    /Unknown TETHER command: launch/,
  )
})
