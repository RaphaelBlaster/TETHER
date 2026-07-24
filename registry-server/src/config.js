import { resolve } from 'node:path'

export function loadConfig(environment = process.env) {
  return Object.freeze({
    host: environment.HOST || '0.0.0.0',
    port: integer(environment.PORT, 10000, { min: 0, max: 65535 }),
    databasePath: resolve(environment.TETHER_DB_PATH || './state/tether-registry.sqlite'),
    registryRoot: resolve(environment.TETHER_REGISTRY_ROOT || '../provider-adapters'),
    redisUrl: environment.REDIS_URL || null,
    mongodbUri: environment.MONGODB_URI || null,
    mongodbDatabaseName: databaseName(environment.MONGODB_DB_NAME || 'tether_registry'),
    durableStoreRequired: environment.DURABLE_STORE_REQUIRED === 'true',
    trustProxy: environment.TRUST_PROXY === 'true',
    rateLimit: integer(environment.DRIFT_RATE_LIMIT, 60, { min: 1, max: 10_000 }),
    rateWindowSeconds: integer(environment.DRIFT_RATE_WINDOW_SECONDS, 60, { min: 1, max: 86_400 }),
    dedupeSeconds: integer(environment.DRIFT_DEDUPE_SECONDS, 300, { min: 1, max: 86_400 }),
    maintenanceThreshold: integer(environment.DRIFT_JOB_THRESHOLD, 3, { min: 1, max: 1_000_000 }),
    selectorRequestCacheSeconds: integer(environment.SELECTOR_REQUEST_CACHE_SECONDS, 300, { min: 30, max: 86_400 }),
    selectorRequestRetentionSeconds: integer(environment.SELECTOR_REQUEST_RETENTION_SECONDS, 7_776_000, { min: 86_400, max: 31_536_000 }),
    rateLimitSalt: environment.RATE_LIMIT_SALT || 'tether-development-only',
    operatorPassword: environment.TETHER_OPERATOR_PASSWORD || null,
    operatorSessionSecret: environment.TETHER_OPERATOR_SESSION_SECRET || null,
    operatorSessionSeconds: integer(environment.TETHER_OPERATOR_SESSION_SECONDS, 3600, { min: 300, max: 86_400 }),
    maxRequestBytes: 2 * 1024,
  })
}

function databaseName(value) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error('MONGODB_DB_NAME must contain only letters, numbers, underscores, or hyphens')
  }
  return value
}

function integer(value, fallback, { min, max }) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid numeric configuration value: ${value}`)
  }
  return parsed
}
