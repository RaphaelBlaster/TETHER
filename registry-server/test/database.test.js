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
    now: () => `2026-07-23T00:00:0${tick++}.000Z`,
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
  database.close()
})
