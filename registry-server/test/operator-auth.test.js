import assert from 'node:assert/strict'
import test from 'node:test'

import { createOperatorAuth } from '../src/operator-auth.js'

test('operator auth issues short-lived, scoped, secure sessions', async () => {
  let now = 1000
  const auth = createOperatorAuth({
    password: 'correct horse battery staple',
    sessionSecret: 'test-session-secret-that-is-at-least-32-characters',
    sessionSeconds: 60,
    now: () => now,
  })

  assert.equal(auth.enabled, true)
  assert.equal(await auth.createSession('wrong password'), null)
  const token = await auth.createSession('correct horse battery staple')
  const cookie = auth.sessionCookie(token)
  assert.match(cookie, /^tether_operator=/)
  assert.match(cookie, /Path=\/operator/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Strict/)

  const request = { headers: { cookie: cookie.split(';')[0] } }
  assert.equal(await auth.verifyRequest(request), true)
  now = 1061
  assert.equal(await auth.verifyRequest(request), false)
})

test('operator auth stays disabled when secrets are missing or too short', async () => {
  const auth = createOperatorAuth({
    password: 'short',
    sessionSecret: 'also-short',
  })
  assert.equal(auth.enabled, false)
  assert.equal(await auth.createSession('short'), null)
  assert.equal(await auth.verifyRequest({ headers: {} }), false)
})
