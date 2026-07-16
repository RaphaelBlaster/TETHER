import { resolveFingerprint } from './element-fingerprint.js'
import { normalizeCalibrationTarget } from './target-normalizer.js'

export function validateCalibrationProfile(root, profile, {
  isVisible = defaultIsVisible,
} = {}) {
  return resolveCalibrationControls(root, profile, { isVisible }).validation
}

export function resolveCalibrationControls(root, profile, {
  isVisible = defaultIsVisible,
} = {}) {
  const composer = resolveFingerprint(root, profile.composer, { allowAncestorDrift: true })
  if (!composer.element) {
    return resolved(
      result(composer.matchCount > 1 ? 'ambiguous' : 'composer_not_found', {
        loaded: true,
        composerResolved: false,
        sendResolved: false,
      }),
    )
  }
  if (
    !composer.element.isConnected ||
    normalizeCalibrationTarget(composer.element, 'composer') !== composer.element ||
    !isVisible(composer.element)
  ) {
    return resolved(
      result('fingerprint_mismatch', {
        loaded: true,
        composerResolved: true,
        sendResolved: false,
      }),
      composer.element,
    )
  }
  const send = resolveFingerprint(root, profile.send, { allowAncestorDrift: true })
  if (!send.element) {
    if (send.matchCount === 0 && composerIsEmpty(composer.element)) {
      return resolved(
        result('valid_send_dormant', {
          valid: true,
          loaded: true,
          composerResolved: true,
          sendResolved: false,
        }),
        composer.element,
      )
    }
    return resolved(
      result(send.matchCount > 1 ? 'ambiguous' : 'send_not_found', {
        loaded: true,
        composerResolved: true,
        sendResolved: false,
      }),
      composer.element,
    )
  }
  if (
    !send.element.isConnected ||
    normalizeCalibrationTarget(send.element, 'send') !== send.element ||
    !isVisible(send.element)
  ) {
    return resolved(
      result('fingerprint_mismatch', {
        loaded: true,
        composerResolved: true,
        sendResolved: true,
      }),
      composer.element,
      send.element,
    )
  }
  return resolved(
    result('valid', {
      loaded: true,
      composerResolved: true,
      sendResolved: true,
    }),
    composer.element,
    send.element,
  )
}

function composerIsEmpty(composer) {
  const tagName = composer.tagName?.toLowerCase()
  const text = tagName === 'input' || tagName === 'textarea'
    ? composer.value
    : composer.textContent
  return String(text ?? '').trim().length === 0
}

function resolved(validation, composer = null, send = null) {
  return { validation, composer, send }
}

function defaultIsVisible(element) {
  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element)
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false
  const rect = element.getBoundingClientRect?.()
  return !rect || (rect.width > 0 && rect.height > 0)
}

function result(code, details = {}) {
  return {
    code,
    valid: code === 'valid',
    loaded: false,
    composerResolved: false,
    sendResolved: false,
    ...details,
  }
}
