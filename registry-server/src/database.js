import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function createRegistryDatabase({ path, now = () => new Date().toISOString() }) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = NORMAL')
  migrate(database)

  const upsertDrift = database.prepare(`
    INSERT INTO drift_aggregates (
      origin, adapter_version, extension_version, error_code,
      report_count, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(origin, adapter_version, extension_version, error_code)
    DO UPDATE SET
      report_count = report_count + 1,
      last_seen_at = excluded.last_seen_at
  `)
  const readDrift = database.prepare(`
    SELECT
      origin,
      adapter_version AS adapterVersion,
      extension_version AS extensionVersion,
      error_code AS errorCode,
      report_count AS reportCount,
      first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt
    FROM drift_aggregates
    WHERE origin = ? AND adapter_version = ? AND extension_version = ? AND error_code = ?
  `)
  const findOpenJob = database.prepare(`
    SELECT
      id,
      provider_origin AS origin,
      adapter_version AS adapterVersion,
      error_code AS errorCode,
      trigger_count AS triggerCount,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM maintenance_jobs
    WHERE provider_origin = ? AND adapter_version = ? AND error_code = ?
      AND status IN ('queued', 'running')
    ORDER BY id DESC
    LIMIT 1
  `)
  const insertJob = database.prepare(`
    INSERT INTO maintenance_jobs (
      provider_origin, adapter_version, error_code,
      trigger_count, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `)
  const readJob = database.prepare(`
    SELECT
      id,
      provider_origin AS origin,
      adapter_version AS adapterVersion,
      error_code AS errorCode,
      trigger_count AS triggerCount,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM maintenance_jobs
    WHERE id = ?
  `)
  const recordPublicationStatement = database.prepare(`
    INSERT INTO registry_publications (
      registry_version, generated_at, index_sha256, observed_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(registry_version)
    DO UPDATE SET
      generated_at = excluded.generated_at,
      index_sha256 = excluded.index_sha256,
      observed_at = excluded.observed_at
  `)
  const insertSelectorRequest = database.prepare(`
    INSERT INTO selector_requests (
      request_id, origin, host, status, reason, extension_version,
      adapter_version_at_request, requested_at, updated_at, expires_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(origin) DO UPDATE SET
      request_id = excluded.request_id,
      host = excluded.host,
      status = 'pending',
      reason = excluded.reason,
      extension_version = excluded.extension_version,
      adapter_version_at_request = excluded.adapter_version_at_request,
      requested_at = excluded.requested_at,
      updated_at = excluded.updated_at,
      fulfilled_at = NULL,
      fulfilled_adapter_version = NULL,
      fulfilled_registry_version = NULL,
      expires_at = excluded.expires_at
    WHERE selector_requests.status = 'fulfilled'
  `)
  const readSelectorRequest = database.prepare(`
    SELECT
      request_id AS requestId,
      origin,
      host,
      status,
      reason,
      extension_version AS extensionVersion,
      adapter_version_at_request AS adapterVersionAtRequest,
      requested_at AS requestedAt,
      updated_at AS updatedAt,
      fulfilled_at AS fulfilledAt,
      fulfilled_adapter_version AS fulfilledAdapterVersion,
      fulfilled_registry_version AS fulfilledRegistryVersion,
      expires_at AS expiresAt
    FROM selector_requests
    WHERE origin = ?
  `)
  const listSelectorRequests = database.prepare(`
    SELECT
      request_id AS requestId,
      origin,
      host,
      status,
      reason,
      extension_version AS extensionVersion,
      adapter_version_at_request AS adapterVersionAtRequest,
      requested_at AS requestedAt,
      updated_at AS updatedAt,
      fulfilled_at AS fulfilledAt,
      fulfilled_adapter_version AS fulfilledAdapterVersion,
      fulfilled_registry_version AS fulfilledRegistryVersion,
      expires_at AS expiresAt
    FROM selector_requests
    ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END,
      requested_at ASC
    LIMIT ?
  `)
  const fulfillSelectorRequest = database.prepare(`
    UPDATE selector_requests
    SET
      status = 'fulfilled',
      fulfilled_at = ?,
      fulfilled_adapter_version = ?,
      fulfilled_registry_version = ?,
      updated_at = ?,
      expires_at = ?
    WHERE origin = ?
  `)
  const pruneSelectorRequests = database.prepare(`
    DELETE FROM selector_requests
    WHERE expires_at <= ?
  `)

  return {
    recordDrift(report) {
      const timestamp = now()
      transaction(database, () => {
        upsertDrift.run(
          report.origin,
          report.adapterVersion,
          report.extensionVersion,
          report.errorCode,
          timestamp,
          timestamp,
        )
      })
      return readDrift.get(
        report.origin,
        report.adapterVersion,
        report.extensionVersion,
        report.errorCode,
      )
    },

    ensureMaintenanceJob(aggregate, threshold) {
      if (aggregate.reportCount < threshold) return { created: false, job: null }
      return transaction(database, () => {
        const existing = findOpenJob.get(
          aggregate.origin,
          aggregate.adapterVersion,
          aggregate.errorCode,
        )
        if (existing) return { created: false, job: existing }
        const timestamp = now()
        const result = insertJob.run(
          aggregate.origin,
          aggregate.adapterVersion,
          aggregate.errorCode,
          aggregate.reportCount,
          timestamp,
          timestamp,
        )
        return { created: true, job: readJob.get(Number(result.lastInsertRowid)) }
      })
    },

    recordPublication({ registryVersion, generatedAt, indexSha256 }) {
      recordPublicationStatement.run(registryVersion, generatedAt, indexSha256, now())
    },

    requestSelectors(request, { retentionSeconds }) {
      const timestamp = now()
      pruneSelectorRequests.run(timestamp)
      const expiresAt = addSeconds(timestamp, retentionSeconds)
      const result = insertSelectorRequest.run(
        request.requestId,
        request.origin,
        request.host,
        request.reason,
        request.extensionVersion,
        request.adapterVersionAtRequest,
        timestamp,
        timestamp,
        expiresAt,
      )
      return {
        created: result.changes === 1,
        request: readSelectorRequest.get(request.origin),
      }
    },

    getSelectorRequest(origin) {
      pruneSelectorRequests.run(now())
      return readSelectorRequest.get(origin) ?? null
    },

    getSelectorRequests({ limit = 250 } = {}) {
      pruneSelectorRequests.run(now())
      return listSelectorRequests.all(limit)
    },

    fulfillSelectorRequest(origin, {
      adapterVersion,
      registryVersion,
      retentionSeconds,
    }) {
      const timestamp = now()
      fulfillSelectorRequest.run(
        timestamp,
        adapterVersion,
        registryVersion,
        timestamp,
        addSeconds(timestamp, retentionSeconds),
        origin,
      )
      return readSelectorRequest.get(origin) ?? null
    },

    close() {
      database.close()
    },
  }
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drift_aggregates (
      origin TEXT NOT NULL,
      adapter_version INTEGER NOT NULL CHECK(adapter_version > 0),
      extension_version TEXT NOT NULL,
      error_code TEXT NOT NULL,
      report_count INTEGER NOT NULL CHECK(report_count > 0),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (origin, adapter_version, extension_version, error_code)
    );

    CREATE INDEX IF NOT EXISTS drift_last_seen_idx
      ON drift_aggregates(last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS maintenance_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_origin TEXT NOT NULL,
      adapter_version INTEGER NOT NULL CHECK(adapter_version > 0),
      error_code TEXT NOT NULL,
      trigger_count INTEGER NOT NULL CHECK(trigger_count > 0),
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS maintenance_jobs_status_idx
      ON maintenance_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS registry_publications (
      registry_version INTEGER PRIMARY KEY CHECK(registry_version > 0),
      generated_at TEXT NOT NULL,
      index_sha256 TEXT NOT NULL CHECK(length(index_sha256) = 64),
      observed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS selector_requests (
      request_id TEXT PRIMARY KEY CHECK(length(request_id) = 64),
      origin TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'fulfilled')),
      reason TEXT NOT NULL CHECK(reason IN ('missing_adapter', 'adapter_invalid')),
      extension_version TEXT NOT NULL,
      adapter_version_at_request INTEGER NOT NULL CHECK(adapter_version_at_request >= 0),
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      fulfilled_at TEXT,
      fulfilled_adapter_version INTEGER,
      fulfilled_registry_version INTEGER,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS selector_requests_status_idx
      ON selector_requests(status, requested_at);

    CREATE INDEX IF NOT EXISTS selector_requests_expiry_idx
      ON selector_requests(expires_at);
  `)
}

function addSeconds(timestamp, seconds) {
  return new Date(Date.parse(timestamp) + (seconds * 1000)).toISOString()
}

function transaction(database, operation) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
