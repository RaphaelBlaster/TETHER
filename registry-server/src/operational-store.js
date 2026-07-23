import { createHash } from 'node:crypto'

export async function createOperationalStore({
  redisUrl = null,
  createRedisClient = null,
  logger = console,
  now = () => Date.now(),
} = {}) {
  const memory = createMemoryStore({ now })
  if (!redisUrl) return memory

  try {
    const factory = createRedisClient ?? (await import('redis')).createClient
    const client = factory({ url: redisUrl })
    let lastError = null
    client.on('error', (error) => {
      lastError = error
      logger.error(`TETHER registry Redis error: ${error.message}`)
    })
    await client.connect()

    return {
      kind: 'redis',

      async checkRateLimit(key, limit, windowSeconds) {
        const redisKey = `tether:drift:rate:${key}`
        const count = await client.incr(redisKey)
        if (count === 1) await client.expire(redisKey, windowSeconds)
        const ttl = Math.max(1, await client.ttl(redisKey))
        return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: ttl }
      },

      async claimDedup(key, ttlSeconds) {
        return (await client.set(`tether:drift:dedupe:${key}`, '1', { NX: true, EX: ttlSeconds })) === 'OK'
      },

      async getCache(key) {
        return client.get(`tether:registry:cache:${key}`)
      },

      async setCache(key, value, ttlSeconds) {
        await client.set(`tether:registry:cache:${key}`, value, { EX: ttlSeconds })
      },

      async enqueueMaintenanceJob(job) {
        await client.lPush('tether:maintenance:jobs', JSON.stringify(job))
      },

      status() {
        return {
          kind: 'redis',
          ready: client.isReady,
          error: lastError?.message ?? null,
        }
      },

      async close() {
        if (client.isOpen) await client.quit()
      },
    }
  } catch (error) {
    logger.error(`TETHER registry could not connect to Redis; using process memory: ${error.message}`)
    return {
      ...memory,
      status: () => ({ kind: 'memory', ready: true, degradedFrom: 'redis', error: error.message }),
    }
  }
}

export function digestKey(value) {
  return createHash('sha256').update(value).digest('hex')
}

function createMemoryStore({ now }) {
  const rateLimits = new Map()
  const dedup = new Map()
  const cache = new Map()
  const jobs = []

  function prune(map) {
    const timestamp = now()
    for (const [key, entry] of map) {
      if (entry.expiresAt <= timestamp) map.delete(key)
    }
  }

  return {
    kind: 'memory',

    async checkRateLimit(key, limit, windowSeconds) {
      prune(rateLimits)
      const current = rateLimits.get(key)
      const next = current
        ? { ...current, count: current.count + 1 }
        : { count: 1, expiresAt: now() + windowSeconds * 1000 }
      rateLimits.set(key, next)
      return {
        allowed: next.count <= limit,
        remaining: Math.max(0, limit - next.count),
        retryAfter: Math.max(1, Math.ceil((next.expiresAt - now()) / 1000)),
      }
    },

    async claimDedup(key, ttlSeconds) {
      prune(dedup)
      if (dedup.has(key)) return false
      dedup.set(key, { expiresAt: now() + ttlSeconds * 1000 })
      return true
    },

    async getCache(key) {
      prune(cache)
      return cache.get(key)?.value ?? null
    },

    async setCache(key, value, ttlSeconds) {
      cache.set(key, { value, expiresAt: now() + ttlSeconds * 1000 })
    },

    async enqueueMaintenanceJob(job) {
      jobs.push(job)
    },

    status() {
      return { kind: 'memory', ready: true }
    },

    async close() {},
  }
}
