import assert from 'node:assert/strict'
import test from 'node:test'

import { createMongoRegistryDatabase } from '../src/mongodb-database.js'

const REPORT = {
  origin: 'https://tinker.thinkingmachines.ai',
  adapterVersion: 1,
  extensionVersion: '0.1.0',
  errorCode: 'assistant_selector_missing',
}

test('MongoDB adapter creates indexes, aggregates drift and deduplicates threshold jobs', async () => {
  const client = new FakeMongoClient()
  let tick = 0
  const database = await createMongoRegistryDatabase({
    uri: 'mongodb://example.test:27017',
    databaseName: 'tether_test',
    MongoClientClass: class {
      constructor() {
        return client
      }
    },
    now: () => `2026-07-23T00:00:0${tick++}.000Z`,
  })

  assert.equal(client.connected, true)
  assert.equal(client.databaseName, 'tether_test')
  assert.equal(client.collection('drift_aggregates').indexes.length, 2)

  assert.equal((await database.recordDrift(REPORT)).reportCount, 1)
  const aggregate = await database.recordDrift(REPORT)
  assert.equal(aggregate.reportCount, 2)

  const first = await database.ensureMaintenanceJob(aggregate, 2)
  assert.equal(first.created, true)
  assert.equal(first.job.status, 'queued')
  const duplicate = await database.ensureMaintenanceJob(aggregate, 2)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.job.id, first.job.id)

  await database.recordPublication({
    registryVersion: 1,
    generatedAt: '2026-07-23T00:00:00.000Z',
    indexSha256: 'a'.repeat(64),
  })
  assert.equal(client.collection('registry_publications').documents.size, 1)

  await database.close()
  assert.equal(client.closed, true)
})

class FakeMongoClient {
  constructor() {
    this.connected = false
    this.closed = false
    this.collections = new Map()
  }

  async connect() {
    this.connected = true
  }

  db(name) {
    this.databaseName = name
    return {
      collection: (collectionName) => this.collection(collectionName),
    }
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection())
    return this.collections.get(name)
  }

  async close() {
    this.closed = true
  }
}

class FakeCollection {
  constructor() {
    this.indexes = []
    this.documents = new Map()
  }

  async createIndex(keys, options) {
    this.indexes.push({ keys, options })
    return options.name
  }

  async findOneAndUpdate(filter, update) {
    const id = identity(filter)
    const current = this.documents.get(id) ?? { ...filter, ...update.$setOnInsert }
    applyUpdate(current, update)
    this.documents.set(id, current)
    return structuredClone(current)
  }

  async updateOne(filter, update) {
    const id = filter._id ?? identity(filter)
    const exists = this.documents.has(id)
    const current = this.documents.get(id) ?? { ...filter, ...update.$setOnInsert }
    applyUpdate(current, update)
    this.documents.set(id, current)
    return { upsertedCount: exists ? 0 : 1 }
  }

  async findOne(filter) {
    const value = this.documents.get(filter._id ?? identity(filter))
    return value ? structuredClone(value) : null
  }
}

function applyUpdate(target, update) {
  Object.assign(target, update.$setOnInsert ?? {}, update.$set ?? {})
  for (const [key, increment] of Object.entries(update.$inc ?? {})) {
    target[key] = (target[key] ?? 0) + increment
  }
}

function identity(filter) {
  return JSON.stringify(Object.entries(filter).sort(([left], [right]) => left.localeCompare(right)))
}
