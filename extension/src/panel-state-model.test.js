import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCalibrationStatus, projectPrimaryStatus } from './panel-state-model.js'

test('projects restricted, permission, and activation copy without internal IDs', () => {
  assert.deepEqual(projectPrimaryStatus({ access: 'restricted' }), {
    heading: 'TETHER unavailable',
    body: 'This browser page does not allow extension access.',
    action: null,
  })
  assert.equal(projectPrimaryStatus({ access: 'required' }).action, 'Enable TETHER for this site')
  const inactive = projectPrimaryStatus({
    access: 'granted',
    calibration: { state: 'valid' },
    activation: { state: 'inactive' },
  })
  assert.equal(inactive.heading, 'Ready to activate')
  assert.equal(inactive.action, 'Activate TETHER for this tab')
  const active = projectPrimaryStatus({
    access: 'granted',
    calibration: { state: 'valid' },
    activation: { state: 'active' },
  })
  assert.equal(active.action, 'Deactivate TETHER for this tab')
  assert.equal(projectPrimaryStatus({
    access: 'granted',
    calibration: { state: 'needs_update' },
    activation: { state: 'active' },
  }).action, 'Deactivate TETHER for this tab')
  assert.equal(JSON.stringify([inactive, active]).includes('browserSessionId'), false)
})

test('projects every user-visible calibration state independently of activation', () => {
  assert.equal(projectCalibrationStatus('access_required').heading, 'Access required')
  assert.equal(projectCalibrationStatus('missing').heading, 'Calibration required')
  assert.equal(projectCalibrationStatus('valid').heading, 'Calibration ready')
  assert.equal(projectCalibrationStatus('invalid').heading, 'Calibration needs updating')
  assert.equal(projectCalibrationStatus('needs_update').heading, 'Calibration needs updating')
  assert.equal(projectCalibrationStatus('validation_failed').heading, 'Calibration validation failed')
})
