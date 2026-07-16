export const CALIBRATION_PROFILE_VERSION = 1

export function inspectCalibrationProfile(profile, origin) {
  if (!profile) return result('missing')
  if (
    profile.version !== CALIBRATION_PROFILE_VERSION ||
    profile.origin !== origin ||
    !isFingerprint(profile.composer) ||
    !isFingerprint(profile.send) ||
    (profile.responseCalibration != null && !isResponseCalibration(profile.responseCalibration))
  ) {
    return result('schema_invalid', { loaded: true, profile })
  }
  return result('stored', { loaded: true, profile })
}

export function isResponseCalibration(value) {
  return Boolean(
    value &&
      value.version === 1 &&
      value.sampleCount === 3 &&
      isFingerprint(value.conversationRoot) &&
      isStructuralFingerprint(value.assistantTurn) &&
      isStructuralFingerprint(value.assistantContent),
  )
}

function isStructuralFingerprint(fingerprint) {
  return Boolean(
    fingerprint &&
      fingerprint.version === 1 &&
      typeof fingerprint.tagName === 'string' &&
      fingerprint.tagName &&
      fingerprint.attributes &&
      typeof fingerprint.attributes === 'object' &&
      typeof fingerprint.primarySelector === 'string' &&
      fingerprint.primarySelector &&
      Array.isArray(fingerprint.fallbackSelectors) &&
      Number.isInteger(fingerprint.expectedMatchCount) &&
      fingerprint.expectedMatchCount >= 1,
  )
}

function isFingerprint(fingerprint) {
  return Boolean(
    fingerprint &&
      fingerprint.version === 1 &&
      typeof fingerprint.tagName === 'string' &&
      fingerprint.tagName &&
      fingerprint.attributes &&
      typeof fingerprint.attributes === 'object' &&
      typeof fingerprint.primarySelector === 'string' &&
      Array.isArray(fingerprint.fallbackSelectors) &&
      Array.isArray(fingerprint.ancestorChain),
  )
}

function result(code, details = {}) {
  return {
    code,
    valid: false,
    loaded: false,
    composerResolved: false,
    sendResolved: false,
    ...details,
  }
}
