import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasCalibrationAccess,
  permissionPatternForOrigin,
  requestCalibrationAccess,
} from './calibration/calibration-access.js'

test('requests access only for the selected origin', async () => {
  let requested
  await requestCalibrationAccess('https://gemini.google.com', async (permissions) => {
    requested = permissions
    return true
  })
  assert.deepEqual(requested, { origins: ['https://gemini.google.com/*'] })
})

test('checks the same origin-scoped permission', async () => {
  let checked
  const permitted = await hasCalibrationAccess('https://chatgpt.com', async (permissions) => {
    checked = permissions
    return true
  })
  assert.equal(permitted, true)
  assert.deepEqual(checked, { origins: ['https://chatgpt.com/*'] })
})

test('rejects paths and restricted origins as permission origins', () => {
  assert.throws(() => permissionPatternForOrigin('https://example.com/path'))
  assert.throws(() => permissionPatternForOrigin('chrome://extensions'))
})
