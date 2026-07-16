import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DEFAULT_CODEX_ARGS, probeAdapter, waitForAdapter } from '../lib/launcher.js'

test('Codex defaults select the embedded TETHER Responses provider', () => {
  assert.ok(DEFAULT_CODEX_ARGS.includes('tether-compact'))
  assert.ok(DEFAULT_CODEX_ARGS.includes('model_provider="tether"'))
  assert.ok(DEFAULT_CODEX_ARGS.includes('model_providers.tether.base_url="http://127.0.0.1:8766/v1"'))
  assert.ok(DEFAULT_CODEX_ARGS.includes('model_providers.tether.wire_api="responses"'))
})

test('probeAdapter accepts only the TETHER health contract', async () => {
  const healthy = await probeAdapter({ fetchImpl: async () => ({
    ok: true,
    json: async () => ({ status: 'ok', service: 'tether-adapter' }),
  }) })
  const unrelated = await probeAdapter({ fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', service: 'something-else' }),
  }) })
  const legacy = await probeAdapter({ fetchImpl: async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: '/v1/models and HTTP Responses are unsupported in Checkpoint 8C' }),
  }) })
  assert.equal(healthy, true)
  assert.equal(legacy, true)
  assert.equal(unrelated, false)
})

test('waitForAdapter resolves after the embedded service is ready', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })
  let attempts = 0
  await waitForAdapter({
    child,
    timeoutMs: 1_000,
    probe: async () => ++attempts === 2,
  })
  assert.equal(attempts, 2)
})

test('waitForAdapter reports an early adapter exit', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: 1, signalCode: null })
  await assert.rejects(
    waitForAdapter({ child, timeoutMs: 100, probe: async () => false }),
    /exited during startup/,
  )
})
