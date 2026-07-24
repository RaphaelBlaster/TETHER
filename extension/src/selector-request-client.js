export const SELECTOR_REQUEST_CACHE_KEY = 'tetherSelectorRequestStatus'

const MAX_RESPONSE_BYTES = 16 * 1024

export function createSelectorRequestClient({
  baseUrl,
  storage,
  extensionVersion,
  fetchImpl = fetch,
  now = () => Date.now(),
  maxEntries = 64,
} = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('Selector request storage is required')
  }
  const base = registryBase(baseUrl)
  const pending = new Map()
  let cachePromise = null

  async function loadCache() {
    if (!cachePromise) {
      cachePromise = storage.get(SELECTOR_REQUEST_CACHE_KEY).then((stored) => {
        const cache = stored?.[SELECTOR_REQUEST_CACHE_KEY]
        return cache && typeof cache === 'object' && cache.origins
          ? cache
          : { origins: {} }
      })
    }
    return cachePromise
  }

  async function persist(origin, value) {
    const cache = await loadCache()
    cache.origins[origin] = {
      value,
      checkedAt: now(),
      expiresAt: now() + (Math.max(30, value.nextPollAfterSeconds ?? 300) * 1000),
    }
    const entries = Object.entries(cache.origins)
      .sort(([, left], [, right]) => right.checkedAt - left.checkedAt)
      .slice(0, maxEntries)
    cache.origins = Object.fromEntries(entries)
    await storage.set({ [SELECTOR_REQUEST_CACHE_KEY]: cache })
    return value
  }

  async function status(origin, { refresh = false } = {}) {
    const normalized = normalizeOrigin(origin)
    const cache = await loadCache()
    const local = cache.origins[normalized]
    if (!refresh && local && local.expiresAt > now()) return local.value

    try {
      const endpoint = new URL('/v1/selector-requests/status', base)
      endpoint.searchParams.set('origin', normalized)
      const response = await fetchImpl(endpoint.href, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      })
      const value = await boundedJson(response)
      if (!response.ok) throw coded(value?.error?.code ?? 'selector_status_unavailable', value?.error?.message ?? `Selector status returned HTTP ${response.status}`)
      return persist(normalized, validateStatus(value, normalized))
    } catch (error) {
      if (local?.value) return { ...local.value, stale: true }
      return {
        requestId: null,
        origin: normalized,
        status: 'unavailable',
        requestedAt: null,
        adapterVersion: null,
        stale: true,
        error: error instanceof Error ? error.message : 'Selector status is unavailable',
      }
    }
  }

  async function request(origin, reason = 'missing_adapter', adapterVersion = 0) {
    const normalized = normalizeOrigin(origin)
    if (pending.has(normalized)) return pending.get(normalized)
    const operation = (async () => {
      const current = await status(normalized)
      if (current.status === 'pending' ||
          (current.status === 'available' && reason === 'missing_adapter')) {
        return current
      }

      const requestId = await selectorRequestId(normalized)
      const endpoint = new URL('/v1/selector-requests', base)
      const response = await fetchImpl(endpoint.href, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': requestId,
        },
        body: JSON.stringify({
          origin: normalized,
          extensionVersion,
          reason,
          adapterVersion,
        }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      })
      const value = await boundedJson(response)
      if (!response.ok) throw coded(value?.error?.code ?? 'selector_request_failed', value?.error?.message ?? `Selector request returned HTTP ${response.status}`)
      return persist(normalized, validateStatus(value, normalized))
    })().finally(() => pending.delete(normalized))
    pending.set(normalized, operation)
    return operation
  }

  return { status, request }
}

export async function selectorRequestId(origin) {
  const normalized = normalizeOrigin(origin)
  const bytes = new TextEncoder().encode(`tether-selector-request-v1:${normalized}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function boundedJson(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw coded('selector_response_too_large', 'Selector registry response is too large')
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw coded('selector_response_too_large', 'Selector registry response is too large')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw coded('selector_response_invalid', 'Selector registry returned invalid JSON')
  }
}

function validateStatus(value, origin) {
  if (!value ||
      value.origin !== origin ||
      !['not_requested', 'pending', 'available'].includes(value.status) ||
      (value.requestId !== null && !/^[a-f0-9]{64}$/.test(value.requestId))) {
    throw coded('selector_response_invalid', 'Selector registry returned an invalid status')
  }
  return Object.freeze({
    requestId: value.requestId,
    origin,
    status: value.status,
    duplicate: Boolean(value.duplicate),
    requestedAt: value.requestedAt ?? null,
    fulfilledAt: value.fulfilledAt ?? null,
    adapterVersion: Number.isSafeInteger(value.adapterVersion) ? value.adapterVersion : null,
    nextPollAfterSeconds: Number.isSafeInteger(value.nextPollAfterSeconds) ? value.nextPollAfterSeconds : 300,
  })
}

function registryBase(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Selector registry URL is invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Selector registry must be an HTTPS base URL')
  }
  return url
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value) throw new Error()
    return url.origin
  } catch {
    throw coded('origin_invalid', 'origin must be an exact HTTPS origin')
  }
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
