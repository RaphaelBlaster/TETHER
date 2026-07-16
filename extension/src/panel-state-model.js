// Shared with the direct-CDP browser-turn engine. The existing panel helpers
// below remain the source of truth for the old side-panel UI.
export const OperationStage = Object.freeze({
  VALIDATING_SESSION: 'validating_session',
  ATTACHING_DEBUGGER: 'attaching_debugger',
  CAPTURING_BASELINE: 'capturing_baseline',
  RESOLVING_COMPOSER: 'resolving_composer',
  WRITING_PROMPT: 'writing_prompt',
  VERIFYING_PROMPT: 'verifying_prompt',
  RESOLVING_SEND: 'resolving_send',
  SUBMITTING: 'submitting',
  VERIFYING_SUBMISSION: 'verifying_submission',
  OBSERVING_RESPONSE: 'observing_response',
  WAITING_FOR_STABILITY: 'waiting_for_stability',
  COMPLETE: 'complete',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
})

export function projectPrimaryStatus(panelState) {
  if (panelState.access === 'restricted') {
    return {
      heading: 'TETHER unavailable',
      body: 'This browser page does not allow extension access.',
      action: null,
    }
  }
  if (panelState.access === 'required') {
    return {
      heading: 'Set up this site',
      body: 'Allow TETHER to access this site before calibration.',
      action: 'Enable TETHER for this site',
    }
  }
  const active = panelState.activation?.state === 'active'
  const calibrated = panelState.calibration?.state === 'valid'
  return {
    heading: active ? 'TETHER is active' : calibrated ? 'Ready to activate' : 'Set up this site',
    body: active
      ? 'This tab is available for TETHER operations.'
      : calibrated
        ? 'TETHER is configured for this site.'
        : 'Complete calibration before activating TETHER for this tab.',
    action: active
      ? 'Deactivate TETHER for this tab'
      : calibrated ? 'Activate TETHER for this tab' : null,
  }
}

export function projectCalibrationStatus(calibrationState) {
  if (calibrationState === 'access_required') {
    return {
      heading: 'Access required',
      body: 'Allow site access before TETHER can validate or update calibration.',
      action: null,
    }
  }
  if (calibrationState === 'valid') {
    return {
      heading: 'Calibration ready',
      body: 'TETHER has saved and validated controls for this site.',
      action: 'Recalibrate this site',
    }
  }
  if (calibrationState === 'missing') {
    return {
      heading: 'Calibration required',
      body: 'Select this site’s composer and Send control.',
      action: 'Calibrate this site',
    }
  }
  if (calibrationState === 'validation_failed') {
    return {
      heading: 'Calibration validation failed',
      body: 'TETHER could not validate the saved controls on the current page.',
      action: 'Recalibrate this site',
    }
  }
  return {
    heading: 'Calibration needs updating',
    body: 'The saved controls could not be resolved reliably on the current page.',
    action: 'Recalibrate this site',
  }
}
