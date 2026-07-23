import { createHash } from 'node:crypto'

export async function createMongoRegistryDatabase({
  uri,
  databaseName = 'tether_registry',
  MongoClientClass = null,
  now = () => new Date().toISOString(),
}) {
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('A MongoDB connection URI is required')
  }
  const Client = MongoClientClass ?? (await import('mongodb')).MongoClient
  const client = new Client(uri, {
    appName: 'tether-provider-registry',
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10_000,
  })
  await client.connect()

  const database = client.db(databaseName)
  const driftAggregates = database.collection('drift_aggregates')
  const maintenanceJobs = database.collection('maintenance_jobs')
  const registryPublications = database.collection('registry_publications')

  await Promise.all([
    driftAggregates.createIndex(
      { origin: 1, adapterVersion: 1, extensionVersion: 1, errorCode: 1 },
      { unique: true, name: 'drift_identity_unique' },
    ),
    driftAggregates.createIndex(
      { lastSeenAt: -1 },
      { name: 'drift_last_seen' },
    ),
    maintenanceJobs.createIndex(
      { status: 1, createdAt: 1 },
      { name: 'maintenance_status_created' },
    ),
    registryPublications.createIndex(
      { observedAt: -1 },
      { name: 'publication_observed' },
    ),
  ])

  return {
    kind: 'mongodb',

    async recordDrift(report) {
      const timestamp = now()
      const document = await driftAggregates.findOneAndUpdate(
        {
          origin: report.origin,
          adapterVersion: report.adapterVersion,
          extensionVersion: report.extensionVersion,
          errorCode: report.errorCode,
        },
        {
          $inc: { reportCount: 1 },
          $set: { lastSeenAt: timestamp },
          $setOnInsert: { firstSeenAt: timestamp },
        },
        {
          upsert: true,
          returnDocument: 'after',
        },
      )
      if (!document) throw new Error('MongoDB did not return the updated drift aggregate')
      return driftAggregate(document)
    },

    async ensureMaintenanceJob(aggregate, threshold) {
      if (aggregate.reportCount < threshold) return { created: false, job: null }
      const thresholdBucket = Math.floor((aggregate.reportCount - 1) / threshold) + 1
      const id = maintenanceJobId(aggregate, thresholdBucket)
      const timestamp = now()
      const document = {
        _id: id,
        origin: aggregate.origin,
        adapterVersion: aggregate.adapterVersion,
        errorCode: aggregate.errorCode,
        triggerCount: aggregate.reportCount,
        thresholdBucket,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const result = await maintenanceJobs.updateOne(
        { _id: id },
        { $setOnInsert: document },
        { upsert: true },
      )
      const stored = await maintenanceJobs.findOne({ _id: id })
      return {
        created: result.upsertedCount === 1,
        job: maintenanceJob(stored),
      }
    },

    async recordPublication({ registryVersion, generatedAt, indexSha256 }) {
      const observedAt = now()
      await registryPublications.updateOne(
        { _id: registryVersion },
        {
          $set: {
            registryVersion,
            generatedAt,
            indexSha256,
            observedAt,
          },
        },
        { upsert: true },
      )
    },

    async close() {
      await client.close()
    },
  }
}

function maintenanceJobId(aggregate, thresholdBucket) {
  return createHash('sha256')
    .update(JSON.stringify([
      aggregate.origin,
      aggregate.adapterVersion,
      aggregate.errorCode,
      thresholdBucket,
    ]))
    .digest('hex')
}

function driftAggregate(document) {
  return {
    origin: document.origin,
    adapterVersion: document.adapterVersion,
    extensionVersion: document.extensionVersion,
    errorCode: document.errorCode,
    reportCount: document.reportCount,
    firstSeenAt: document.firstSeenAt,
    lastSeenAt: document.lastSeenAt,
  }
}

function maintenanceJob(document) {
  if (!document) throw new Error('MongoDB maintenance job was not found after upsert')
  return {
    id: document._id,
    origin: document.origin,
    adapterVersion: document.adapterVersion,
    errorCode: document.errorCode,
    triggerCount: document.triggerCount,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}
