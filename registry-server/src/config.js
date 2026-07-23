import { resolve } from 'node:path'

export function loadConfig(environment = process.env) {
  return Object.freeze({
    host: environment.HOST || '0.0.0.0',
    port: integer(environment.PORT, 10000, { min: 0, max: 65535 }),
    databasePath: resolve(environment.TETHER_DB_PATH || './state/tether-registry.sqlite'),
    registryRoot: resolve(environment.TETHER_REGISTRY_ROOT || '../provider-adapters'),
    redisUrl: environment.REDIS_URL || null,
    trustProxy: environment.TRUST_PROXY === 'true',
    rateLimit: integer(environment.DRIFT_RATE_LIMIT, 60, { min: 1, max: 10_000 }),
    rateWindowSeconds: integer(environment.DRIFT_RATE_WINDOW_SECONDS, 60, { min: 1, max: 86_400 }),
    dedupeSeconds: integer(environment.DRIFT_DEDUPE_SECONDS, 300, { min: 1, max: 86_400 }),
    maintenanceThreshold: integer(environment.DRIFT_JOB_THRESHOLD, 3, { min: 1, max: 1_000_000 }),
    rateLimitSalt: environment.RATE_LIMIT_SALT || 'tether-development-only',
    maxRequestBytes: 2 * 1024,
  })
}

function integer(value, fallback, { min, max }) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid numeric configuration value: ${value}`)
  }
  return parsed
}
