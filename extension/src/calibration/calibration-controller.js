import { createFingerprint, resolveFingerprint } from './element-fingerprint.js'

export const CALIBRATION_STAGE = Object.freeze({
  IDLE: 'idle',
  SELECTING_COMPOSER: 'selecting_composer',
  SELECTING_SEND: 'selecting_send',
  COMPLETE: 'complete',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
})

export function createCalibrationController({ root = document, origin = location.origin } = {}) {
  let stage = CALIBRATION_STAGE.IDLE
  let composer = null
  let composerElement = null

  function start() {
    stage = CALIBRATION_STAGE.SELECTING_COMPOSER
    composer = null
    composerElement = null
    return snapshot()
  }

  function confirm(element) {
    if (![CALIBRATION_STAGE.SELECTING_COMPOSER, CALIBRATION_STAGE.SELECTING_SEND].includes(stage)) {
      throw new Error('Calibration is not accepting a selection')
    }
    const fingerprint = createFingerprint(element, root)
    if (stage === CALIBRATION_STAGE.SELECTING_COMPOSER) {
      composer = fingerprint
      composerElement = element
      stage = CALIBRATION_STAGE.SELECTING_SEND
      return snapshot()
    }

    if (element === composerElement) throw new Error('Composer and Send must be different controls')
    const send = fingerprint
    if (!resolveFingerprint(root, composer).element || !resolveFingerprint(root, send).element) {
      stage = CALIBRATION_STAGE.FAILED
      throw new Error('A calibrated target could not be resolved again')
    }
    stage = CALIBRATION_STAGE.COMPLETE
    return { ...snapshot(), profile: { version: 1, origin, composer, send, createdAt: Date.now() } }
  }

  function cancel() {
    stage = CALIBRATION_STAGE.CANCELLED
    return snapshot()
  }

  function snapshot() {
    return { stage, hasComposer: Boolean(composer) }
  }

  return { start, confirm, cancel, snapshot }
}
