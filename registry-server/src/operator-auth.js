import { createHash, timingSafeEqual } from 'node:crypto'

import { SignJWT, jwtVerify } from 'jose'

const COOKIE_NAME = 'tether_operator'

export function createOperatorAuth({
  password,
  sessionSecret,
  now = () => Math.floor(Date.now() / 1000),
  sessionSeconds = 3600,
} = {}) {
  const enabled = typeof password === 'string' &&
    password.length >= 12 &&
    typeof sessionSecret === 'string' &&
    sessionSecret.length >= 32
  const secret = enabled ? new TextEncoder().encode(sessionSecret) : null

  async function createSession(candidate) {
    if (!enabled || !safeEqual(candidate, password)) return null
    const issuedAt = now()
    return new SignJWT({ role: 'operator' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('tether-provider-registry')
      .setAudience('tether-operator')
      .setSubject('operator')
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + sessionSeconds)
      .sign(secret)
  }

  async function verifyRequest(request) {
    if (!enabled) return false
    const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME]
    if (!token) return false
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'tether-provider-registry',
        audience: 'tether-operator',
        currentDate: new Date(now() * 1000),
      })
      return payload.role === 'operator' && payload.sub === 'operator'
    } catch {
      return false
    }
  }

  return {
    enabled,
    createSession,
    verifyRequest,
    sessionCookie(token) {
      return `${COOKIE_NAME}=${token}; Path=/operator; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionSeconds}`
    },
    clearCookie() {
      return `${COOKIE_NAME}=; Path=/operator; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    },
  }
}

function safeEqual(candidate, expected) {
  if (typeof candidate !== 'string') return false
  const left = createHash('sha256').update(candidate).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

function parseCookies(value) {
  const result = {}
  for (const pair of value.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 1) continue
    const key = pair.slice(0, separator).trim()
    const encoded = pair.slice(separator + 1).trim()
    try {
      result[key] = decodeURIComponent(encoded)
    } catch {
      // Ignore malformed cookies.
    }
  }
  return result
}
