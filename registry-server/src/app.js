import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

import { createDriftReport } from '../../extension/src/provider-adapter-registry.js'
import { createOperatorAuth } from './operator-auth.js'
import { digestKey } from './operational-store.js'
import {
  createSelectorRequest,
  createSelectorRequestReport,
  normalizeSelectorOrigin,
  publicSelectorRequest,
  selectorRequestId,
  selectorStatusCacheKey,
  validateIdempotencyKey,
} from './selector-requests.js'

const DRIFT_KEYS = new Set(['origin', 'adapterVersion', 'extensionVersion', 'errorCode'])
const DRIFT_ERROR_CODES = new Set([
  'composer_selector_missing',
  'send_selector_missing',
  'assistant_selector_missing',
  'response_extraction_failed',
  'completion_signal_missing',
  'manifest_page_invalid',
])
const NOT_FOUND_PAGE = readFileSync(new URL('../public/404.html', import.meta.url))
const STATIC_SITE = new Map([
  ['/', {
    body: readFileSync(new URL('../public/index.html', import.meta.url)),
    contentType: 'text/html; charset=utf-8',
    cacheControl: 'no-cache',
  }],
  ['/site.css', {
    body: readFileSync(new URL('../public/site.css', import.meta.url)),
    contentType: 'text/css; charset=utf-8',
    cacheControl: 'no-cache',
  }],
  ['/site.js', {
    body: readFileSync(new URL('../public/site.js', import.meta.url)),
    contentType: 'text/javascript; charset=utf-8',
    cacheControl: 'no-cache',
  }],
  ['/tether-logo.svg', {
    body: readFileSync(new URL('../public/tether-logo.svg', import.meta.url)),
    contentType: 'image/svg+xml',
    cacheControl: 'public, max-age=86400',
  }],
])
const SITE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join('; ')

export function createRegistryServer({
  config,
  database,
  operationalStore,
  catalog,
  logger = console,
}) {
  const operatorAuth = createOperatorAuth({
    password: config.operatorPassword,
    sessionSecret: config.operatorSessionSecret,
    sessionSeconds: config.operatorSessionSeconds,
  })
  const server = createServer(async (request, response) => {
    const requestId = randomUUID()
    setSecurityHeaders(response, requestId)

    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
      const staticAsset = STATIC_SITE.get(url.pathname)
      if ((request.method === 'GET' || request.method === 'HEAD') && staticAsset) {
        sendStaticAsset(request, response, staticAsset)
        return
      }

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

      if (request.method === 'GET' && url.pathname === '/operator') {
        if (!await operatorAuth.verifyRequest(request)) {
          sendHtml(response, operatorAuth.enabled ? 200 : 503, operatorLoginPage({
            configured: operatorAuth.enabled,
          }))
          return
        }
        const selectorRequests = await database.getSelectorRequests({ limit: 250 })
        sendHtml(response, 200, operatorDashboard(selectorRequests))
        return
      }

      if (request.method === 'POST' && url.pathname === '/operator/session') {
        if (!operatorAuth.enabled) {
          sendHtml(response, 503, operatorLoginPage({ configured: false }))
          return
        }
        const clientKey = clientIdentity(request, config)
        const rate = await operationalStore.checkRateLimit(
          digestKey(`${config.rateLimitSalt}:operator-login:${clientKey}`),
          10,
          300,
        )
        if (!rate.allowed) {
          response.setHeader('retry-after', String(rate.retryAfter))
          sendHtml(response, 429, operatorLoginPage({
            configured: true,
            error: 'Too many login attempts. Wait before trying again.',
          }))
          return
        }
        const form = await readForm(request, config.maxRequestBytes)
        const token = await operatorAuth.createSession(form.get('password'))
        if (!token) {
          sendHtml(response, 401, operatorLoginPage({
            configured: true,
            error: 'The operator credentials were not accepted.',
          }))
          return
        }
        response.setHeader('set-cookie', operatorAuth.sessionCookie(token))
        redirect(response, '/operator')
        return
      }

      if (request.method === 'POST' && url.pathname === '/operator/logout') {
        response.setHeader('set-cookie', operatorAuth.clearCookie())
        redirect(response, '/operator')
        return
      }

      if (request.method === 'GET' && url.pathname === '/operator/selector-report.md') {
        if (!await operatorAuth.verifyRequest(request)) {
          redirect(response, '/operator')
          return
        }
        const [selectorRequests, registry] = await Promise.all([
          database.getSelectorRequests({ limit: 250 }),
          catalog.loadIndex(),
        ])
        const report = createSelectorRequestReport(selectorRequests, {
          registryVersion: registry.index.registryVersion,
        })
        const date = new Date().toISOString().slice(0, 10)
        sendText(response, 200, report, {
          contentType: 'text/markdown; charset=utf-8',
          headers: {
            'content-disposition': `attachment; filename="tether-selector-report-${date}.md"`,
            'cache-control': 'no-store',
          },
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

      if (request.method === 'GET' && url.pathname === '/v1/selector-requests/status') {
        const origin = url.searchParams.get('origin')
        if (!origin) throw httpError(400, 'origin_required', 'The origin query parameter is required')
        const status = await resolveSelectorRequestStatus({
          origin,
          catalog,
          database,
          operationalStore,
          config,
        })
        sendJson(response, 200, status, {
          'cache-control': 'no-store',
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/selector-requests') {
        const clientKey = clientIdentity(request, config)
        const rate = await operationalStore.checkRateLimit(
          digestKey(`${config.rateLimitSalt}:selector-request:${clientKey}`),
          config.rateLimit,
          config.rateWindowSeconds,
        )
        response.setHeader('ratelimit-remaining', String(rate.remaining))
        if (!rate.allowed) {
          response.setHeader('retry-after', String(rate.retryAfter))
          throw httpError(429, 'rate_limited', 'Too many selector requests')
        }

        const selectorRequest = createSelectorRequest(await readJson(request, config.maxRequestBytes))
        validateIdempotencyKey(request.headers['idempotency-key'], selectorRequest.requestId)
        const available = await availableSelectorManifest(selectorRequest.origin, catalog)
        if (available && selectorRequestSatisfied(selectorRequest, available.manifest.adapterVersion)) {
          const existing = await database.getSelectorRequest(selectorRequest.origin)
          const record = existing
            ? await database.fulfillSelectorRequest(selectorRequest.origin, {
                adapterVersion: available.manifest.adapterVersion,
                registryVersion: available.registryVersion,
                retentionSeconds: config.selectorRequestRetentionSeconds,
              })
            : {
                ...selectorRequest,
                status: 'available',
                requestedAt: null,
                fulfilledAt: null,
                fulfilledAdapterVersion: available.manifest.adapterVersion,
              }
          sendJson(response, 200, publicSelectorRequest({
            ...record,
            status: 'available',
          }, {
            duplicate: Boolean(existing),
            nextPollAfterSeconds: config.selectorRequestCacheSeconds,
          }), {
            'cache-control': 'no-store',
          })
          return
        }

        const result = await database.requestSelectors(selectorRequest, {
          retentionSeconds: config.selectorRequestRetentionSeconds,
        })
        const payload = publicSelectorRequest({
          ...result.request,
          status: 'pending',
        }, {
          duplicate: !result.created,
          nextPollAfterSeconds: config.selectorRequestCacheSeconds,
        })
        await operationalStore.setCache(
          selectorStatusCacheKey(selectorRequest.origin),
          JSON.stringify(payload),
          config.selectorRequestCacheSeconds,
        )
        sendJson(response, 202, payload, {
          'cache-control': 'no-store',
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

        const aggregate = await database.recordDrift(report)
        const maintenance = await database.ensureMaintenanceJob(aggregate, config.maintenanceThreshold)
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

      const allowedMethods = allowedMethodsForPath(url.pathname)
      if (allowedMethods) {
        response.setHeader('allow', allowedMethods.join(', '))
        throw httpError(405, 'method_not_allowed', 'Method not allowed for this route')
      }
      if (isBrowserNavigation(request, url.pathname)) {
        sendNotFoundPage(request, response)
        return
      }
      throw httpError(404, 'not_found', 'Route not found')
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500
      const code = error.code || 'internal_error'
      if (status >= 500) logger.error(`Registry request ${requestId} failed (${code}): ${error.message}`)
      if (String(request.url || '').startsWith('/operator')) {
        sendHtml(response, status, operatorErrorPage(status))
        return
      }
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
  const body = await readBody(request, maxBytes)
  try {
    return JSON.parse(body)
  } catch {
    throw httpError(400, 'json_invalid', 'Request body must be valid JSON')
  }
}

async function readForm(request, maxBytes) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers['content-type'] || '')) {
    throw httpError(415, 'content_type_invalid', 'Content-Type must be application/x-www-form-urlencoded')
  }
  return new URLSearchParams(await readBody(request, maxBytes))
}

async function readBody(request, maxBytes) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      throw httpError(413, 'request_too_large', `Request exceeds ${maxBytes} bytes`)
    }
  }
  return body
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

function sendJson(response, status, value, headers = {}) {
  if (response.writableEnded) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...corsHeaders(),
    ...headers,
  })
  response.end(body)
}

function sendHtml(response, status, body) {
  sendText(response, status, body, {
    contentType: 'text/html; charset=utf-8',
    headers: { 'cache-control': 'no-store' },
  })
}

function sendText(response, status, body, {
  contentType = 'text/plain; charset=utf-8',
  headers = {},
} = {}) {
  if (response.writableEnded) return
  response.setHeader('content-security-policy', SITE_CONTENT_SECURITY_POLICY.replace("form-action 'none'", "form-action 'self'"))
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}

function redirect(response, location) {
  response.writeHead(303, {
    location,
    'cache-control': 'no-store',
    'content-length': '0',
  })
  response.end()
}

function sendStaticAsset(request, response, asset) {
  response.setHeader('content-security-policy', SITE_CONTENT_SECURITY_POLICY)
  response.writeHead(200, {
    'cache-control': asset.cacheControl,
    'content-type': asset.contentType,
    'content-length': asset.body.length,
  })
  response.end(request.method === 'HEAD' ? undefined : asset.body)
}

function sendNotFoundPage(request, response) {
  response.setHeader('content-security-policy', SITE_CONTENT_SECURITY_POLICY)
  response.writeHead(404, {
    'cache-control': 'no-cache',
    'content-type': 'text/html; charset=utf-8',
    'content-length': NOT_FOUND_PAGE.length,
  })
  response.end(request.method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
}

function isBrowserNavigation(request, pathname) {
  if ((request.method !== 'GET' && request.method !== 'HEAD') || pathname.startsWith('/v1/')) {
    return false
  }
  return String(request.headers.accept || '')
    .split(',')
    .some((value) => value.trim().toLowerCase().startsWith('text/html'))
}

async function resolveSelectorRequestStatus({
  origin,
  catalog,
  database,
  operationalStore,
  config,
}) {
  const normalized = normalizeSelectorOrigin(origin)
  const existing = await database.getSelectorRequest(normalized)
  const available = await availableSelectorManifest(normalized, catalog)
  if (available && (!existing || selectorRequestSatisfied(existing, available.manifest.adapterVersion))) {
    const record = existing
      ? await database.fulfillSelectorRequest(normalized, {
          adapterVersion: available.manifest.adapterVersion,
          registryVersion: available.registryVersion,
          retentionSeconds: config.selectorRequestRetentionSeconds,
        })
      : {
          requestId: selectorRequestId(normalized),
          origin: normalized,
          status: 'available',
          requestedAt: null,
          fulfilledAt: null,
          fulfilledAdapterVersion: available.manifest.adapterVersion,
        }
    return publicSelectorRequest({
      ...record,
      status: 'available',
    }, {
      nextPollAfterSeconds: config.selectorRequestCacheSeconds,
    })
  }

  const cacheKey = selectorStatusCacheKey(normalized)
  const cached = await operationalStore.getCache(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached)
    } catch {
      // Ignore corrupted operational cache entries.
    }
  }

  const payload = existing
    ? publicSelectorRequest({
        ...existing,
        status: 'pending',
      }, {
        duplicate: true,
        nextPollAfterSeconds: config.selectorRequestCacheSeconds,
      })
    : {
        requestId: selectorRequestId(normalized),
        origin: normalized,
        status: 'not_requested',
        duplicate: false,
        requestedAt: null,
        fulfilledAt: null,
        adapterVersion: null,
        nextPollAfterSeconds: config.selectorRequestCacheSeconds,
      }
  await operationalStore.setCache(
    cacheKey,
    JSON.stringify(payload),
    config.selectorRequestCacheSeconds,
  )
  return payload
}

function selectorRequestSatisfied(request, publishedAdapterVersion) {
  return request.reason === 'missing_adapter' ||
    publishedAdapterVersion > request.adapterVersionAtRequest
}

async function availableSelectorManifest(origin, catalog) {
  const [manifest, registry] = await Promise.all([
    catalog.manifestForOrigin(origin),
    catalog.loadIndex(),
  ])
  return manifest ? { manifest: manifest.manifest, registryVersion: registry.index.registryVersion } : null
}

function allowedMethodsForPath(pathname) {
  if (STATIC_SITE.has(pathname)) return ['GET', 'HEAD']
  if (pathname === '/healthz' ||
      pathname === '/v1/adapters/index.json' ||
      pathname === '/v1/adapters/index.sig.json' ||
      pathname === '/v1/adapters' ||
      pathname === '/v1/selector-requests/status' ||
      pathname === '/operator' ||
      pathname === '/operator/selector-report.md') {
    return ['GET']
  }
  if (pathname === '/v1/drift-reports' ||
      pathname === '/v1/selector-requests' ||
      pathname === '/operator/session' ||
      pathname === '/operator/logout') {
    return ['POST']
  }
  return null
}

function operatorLoginPage({ configured, error = null }) {
  const message = configured
    ? 'Authenticate to inspect the selector queue and download the Codex maintenance report.'
    : 'Operator access is disabled until TETHER_OPERATOR_PASSWORD and TETHER_OPERATOR_SESSION_SECRET are configured.'
  return pageShell('TETHER operator', `
    <main class="operator-shell">
      <section class="operator-card">
        <img src="/tether-logo.svg" width="64" height="64" alt="">
        <p class="eyebrow">Private control plane</p>
        <h1>TETHER operator</h1>
        <p>${escapeHtml(message)}</p>
        ${error ? `<p class="operator-error" role="alert">${escapeHtml(error)}</p>` : ''}
        ${configured ? `
          <form class="operator-form" method="post" action="/operator/session">
            <label for="operator-password">Operator password</label>
            <input id="operator-password" name="password" type="password" minlength="12" required autocomplete="current-password">
            <button class="button button-primary" type="submit">Authenticate <span aria-hidden="true">→</span></button>
          </form>
        ` : '<a class="button button-secondary" href="/">Return home</a>'}
      </section>
    </main>
  `)
}

function operatorDashboard(requests) {
  const pending = requests.filter((request) => request.status === 'pending')
  const rows = pending.length
    ? pending.map((request) => `
        <li>
          <div><strong>${escapeHtml(request.host)}</strong><span>${escapeHtml(request.origin)}</span></div>
          <small>${escapeHtml(request.reason)} · ${escapeHtml(request.requestedAt)}</small>
        </li>
      `).join('')
    : '<li><div><strong>Queue clear</strong><span>No pending selector requests.</span></div></li>'
  return pageShell('TETHER selector queue', `
    <main class="operator-shell">
      <section class="operator-card operator-card--wide">
        <div class="operator-heading">
          <div>
            <p class="eyebrow">Private control plane</p>
            <h1>Selector queue</h1>
            <p>${pending.length} pending origin${pending.length === 1 ? '' : 's'} · ${requests.length} retained record${requests.length === 1 ? '' : 's'}</p>
          </div>
          <img src="/tether-logo.svg" width="64" height="64" alt="">
        </div>
        <div class="hero-actions">
          <a class="button button-primary" href="/operator/selector-report.md">Download Codex report <span aria-hidden="true">↓</span></a>
          <a class="button button-secondary" href="/">Product site</a>
        </div>
        <ul class="operator-list">${rows}</ul>
        <form method="post" action="/operator/logout">
          <button class="text-button" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  `)
}

function operatorErrorPage(status) {
  return pageShell(`TETHER error ${status}`, `
    <main class="operator-shell">
      <section class="operator-card">
        <p class="eyebrow">${status} · Request failed</p>
        <h1>Operator request unavailable</h1>
        <p>The control plane could not complete this request.</p>
        <a class="button button-secondary" href="/operator">Return to operator</a>
      </section>
    </main>
  `)
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="#171714">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="/tether-logo.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/site.css?v=20260724-2">
  </head>
  <body>${body}</body>
</html>`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
    'access-control-allow-headers': 'Content-Type, If-None-Match, Idempotency-Key',
    'access-control-expose-headers': 'ETag, X-Tether-Manifest-SHA256, X-Tether-Adapter-Version, RateLimit-Remaining, Retry-After',
  }
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
