import assert from 'node:assert/strict'
import test from 'node:test'

import {
  THEME_TRANSITION_COOLDOWN_MS,
  shouldAnimateThemeTransition,
  themeRevealGeometry,
} from './theme-transition.js'

test('theme reveal starts at the exact center of the pressed button', () => {
  const geometry = themeRevealGeometry(
    { left: 542, top: 108, width: 56, height: 56 },
    { width: 744, height: 1434 },
  )
  assert.equal(geometry.x, 570)
  assert.equal(geometry.y, 136)
  assert.equal(geometry.radius, Math.hypot(570, 1298))
})

test('theme reveal clamps a stale button rectangle to the visible viewport', () => {
  assert.deepEqual(
    themeRevealGeometry(
      { left: 900, top: -100, width: 40, height: 40 },
      { width: 744, height: 1434 },
    ),
    { x: 744, y: 0, radius: Math.hypot(744, 1434) },
  )
})

test('native theme snapshots never overlap or restart inside the cooldown', () => {
  assert.equal(shouldAnimateThemeTransition({
    active: true,
    lastStartedAt: 100,
    now: 10_000,
  }), false)
  assert.equal(shouldAnimateThemeTransition({
    active: false,
    lastStartedAt: 100,
    now: 100 + THEME_TRANSITION_COOLDOWN_MS - 1,
  }), false)
  assert.equal(shouldAnimateThemeTransition({
    active: false,
    lastStartedAt: 100,
    now: 100 + THEME_TRANSITION_COOLDOWN_MS,
  }), true)
})
