import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { createDriftReport } from '../../extension/src/provider-adapter-registry.js'
import { digestKey } from './operational-store.js'

const DRIFT_KEYS = new Set(['origin', 'adapterVersion', 'extensionVersion', 'errorCode'])
const DRIFT_ERROR_CODES = new Set([
  'composer_selector_missing',
  'send_selector_missing',
  'assistant_selector_missing',
  'response_extraction_failed',
  'completion_signal_missing',
  'manifest_page_invalid',
])

export function createRegistryServer({
  config,
  database,
  operationalStore,
  catalog,
  logger = console,
}) {
  const server = createServer(async (request, response) => {
    const requestId = randomUUID()
    setSecurityHeaders(response, requestId)

    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders())
        response.end()
        return
      }

      if (request.method === 'GET' && url.pathname === '/healthz') {
        const registry = await catalog.loadIndex()
        sendJson(response, 200, {
          status: 'ok',
          service: 'tether-provider-registry',
          registryVersion: registry.index.registryVersion,
          operationalStore: operationalStore.status(),
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/adapters/index.json') {
        const entry = await catalog.loadIndex()
        sendConditionalJson(request, response, entry.body, entry.etag, {
          'cache-control': 'public, max-age=60, stale-while-revalidate=300',
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/adapters/index.sig.json') {
        const entry = await catalog.signature()
        sendConditionalJson(request, response, entry.body, entry.etag, {
          'cache-control': 'public, max-age=60, stale-while-revalidate=300',
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/adapters') {
        const origin = url.searchParams.get('origin')
        if (!origin) throw httpError(400, 'origin_required', 'The origin query parameter is required')
        const entry = await catalog.manifestForOrigin(origin)
        if (!entry) throw httpError(404, 'adapter_not_found', 'No published adapter exists for this origin')
        sendConditionalJson(request, response, entry.body, entry.etag, {
          'cache-control': 'public, max-age=60, stale-while-revalidate=300',
          'x-tether-manifest-sha256': entry.sha256,
          'x-tether-adapter-version': String(entry.manifest.adapterVersion),
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/drift-reports') {
        const clientKey = clientIdentity(request, config)
        const rate = await operationalStore.checkRateLimit(
          digestKey(`${config.rateLimitSalt}:${clientKey}`),
          config.rateLimit,
          config.rateWindowSeconds,
        )
        response.setHeader('ratelimit-remaining', String(rate.remaining))
        if (!rate.allowed) {
          response.setHeader('retry-after', String(rate.retryAfter))
          throw httpError(429, 'rate_limited', 'Too many drift reports')
        }

        const input = await readJson(request, config.maxRequestBytes)
        if (!isObject(input) ||
            Object.keys(input).length !== DRIFT_KEYS.size ||
            Object.keys(input).some((key) => !DRIFT_KEYS.has(key))) {
          throw httpError(400, 'drift_report_invalid', 'Drift report fields do not match the privacy-safe contract')
        }
        const report = createDriftReport(input)
        if (!DRIFT_ERROR_CODES.has(report.errorCode)) {
          throw httpError(400, 'drift_report_invalid', 'Drift error code is not supported')
        }
        const published = await catalog.manifestForOrigin(report.origin)
        if (!published) {
          throw httpError(400, 'drift_report_invalid', 'Drift origin is not in the published registry')
        }
        if (report.adapterVersion > published.manifest.adapterVersion) {
          throw httpError(400, 'drift_report_invalid', 'Drift adapter version is newer than the published adapter')
        }
        const fingerprint = digestKey(`${clientKey}:${canonicalReport(report)}`)
        const claimed = await operationalStore.claimDedup(fingerprint, config.dedupeSeconds)
        if (!claimed) {
          sendJson(response, 202, { accepted: false, duplicate: true })
          return
        }

        const aggregate = database.recordDrift(report)
        const maintenance = database.ensureMaintenanceJob(aggregate, config.maintenanceThreshold)
        if (maintenance.created) {
          await operationalStore.enqueueMaintenanceJob(maintenance.job)
        }
        sendJson(response, 202, {
          accepted: true,
          reportCount: aggregate.reportCount,
          maintenanceQueued: maintenance.created,
        })
        return
      }

      throw httpError(404, 'not_found', 'Route not found')
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500
      const code = error.code || 'internal_error'
      if (status >= 500) logger.error(`Registry request ${requestId} failed (${code}): ${error.message}`)
      sendJson(response, status, {
        error: {
          code: status >= 500 ? 'internal_error' : code,
          message: status >= 500 ? 'The registry could not complete the request' : error.message,
          requestId,
        },
      })
    }
  })

  return {
    raw: server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, resolve)
      })
      const address = server.address()
      return { host: config.host, port: address.port }
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    },
  }
}

async function readJson(request, maxBytes) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
    throw httpError(415, 'content_type_invalid', 'Content-Type must be application/json')
  }
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      throw httpError(413, 'request_too_large', `Request exceeds ${maxBytes} bytes`)
    }
  }
  try {
    return JSON.parse(body)
  } catch {
    throw httpError(400, 'json_invalid', 'Request body must be valid JSON')
  }
}

function clientIdentity(request, config) {
  if (config.trustProxy) {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
    if (forwarded) return forwarded
  }
  return request.socket.remoteAddress || 'unknown'
}

function canonicalReport(report) {
  return JSON.stringify([
    report.origin,
    report.adapterVersion,
    report.extensionVersion,
    report.errorCode,
  ])
}

function sendConditionalJson(request, response, body, etag, headers) {
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { etag, ...corsHeaders(), ...headers })
    response.end()
    return
  }
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    etag,
    ...corsHeaders(),
    ...headers,
  })
  response.end(body)
}

function sendJson(response, status, value) {
  if (response.writableEnded) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...corsHeaders(),
  })
  response.end(body)
}

function setSecurityHeaders(response, requestId) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('x-request-id', requestId)
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, If-None-Match',
    'access-control-expose-headers': 'ETag, X-Tether-Manifest-SHA256, X-Tether-Adapter-Version, RateLimit-Remaining, Retry-After',
  }
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
