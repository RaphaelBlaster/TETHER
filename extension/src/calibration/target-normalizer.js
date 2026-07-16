const COMPOSER_SELECTOR = 'textarea, input:not([type]), input[type="text"], [contenteditable="true"], [role="textbox"]'
const SEND_SELECTOR = 'button, [role="button"]'

export function normalizeCalibrationTarget(element, role) {
  if (!element?.closest) return null
  return element.closest(role === 'composer' ? COMPOSER_SELECTOR : SEND_SELECTOR)
}
