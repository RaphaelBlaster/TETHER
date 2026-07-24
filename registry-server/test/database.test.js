import assert from 'node:assert/strict'
import test from 'node:test'

import { createRegistryDatabase } from '../src/database.js'

const REPORT = {
  origin: 'https://tinker.thinkingmachines.ai',
  adapterVersion: 1,
  extensionVersion: '0.1.0',
  errorCode: 'assistant_selector_missing',
}

test('SQLite aggregates privacy-safe drift reports and creates one open job', () => {
  let tick = 0
  const database = createRegistryDatabase({
    path: ':memory:',
    now: () => new Date(Date.UTC(2026, 6, 23, 0, 0, tick++)).toISOString(),
  })

  assert.equal(database.recordDrift(REPORT).reportCount, 1)
  assert.equal(database.ensureMaintenanceJob({ ...REPORT, reportCount: 1 }, 2).job, null)

  const aggregate = database.recordDrift(REPORT)
  assert.equal(aggregate.reportCount, 2)
  const first = database.ensureMaintenanceJob(aggregate, 2)
  assert.equal(first.created, true)
  assert.equal(first.job.status, 'queued')

  const second = database.ensureMaintenanceJob(aggregate, 2)
  assert.equal(second.created, false)
  assert.equal(second.job.id, first.job.id)

  const selectorRequest = {
    requestId: 'b'.repeat(64),
    origin: 'https://new-model.ai',
    host: 'new-model.ai',
    reason: 'missing_adapter',
    extensionVersion: '0.1.0',
    adapterVersionAtRequest: 0,
  }
  const requested = database.requestSelectors(selectorRequest, { retentionSeconds: 3600 })
  assert.equal(requested.created, true)
  assert.equal(requested.request.status, 'pending')
  assert.equal(database.requestSelectors(selectorRequest, { retentionSeconds: 3600 }).created, false)
  assert.equal(database.getSelectorRequests().length, 1)
  assert.equal(database.fulfillSelectorRequest(selectorRequest.origin, {
    adapterVersion: 1,
    registryVersion: 2,
    retentionSeconds: 3600,
  }).status, 'fulfilled')
  assert.equal(database.requestSelectors({
    ...selectorRequest,
    reason: 'adapter_invalid',
    adapterVersionAtRequest: 1,
  }, { retentionSeconds: 3600 }).created, true)
  database.close()
})
