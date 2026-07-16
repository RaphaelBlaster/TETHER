import { replaceEditorText } from '../injection/editor-writer.js'

export const CALIBRATION_COMPOSER_PROBE = 'Dance the night away ✦'

export function createComposerProbe({
  intervalMs = 42,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} = {}) {
  let editor = null
  let timer = null
  let characterCount = 0

  function activate(element) {
    cleanup()
    editor = element
    if (prefersReducedMotion()) {
      characterCount = CALIBRATION_COMPOSER_PROBE.length
      replaceEditorText(element, CALIBRATION_COMPOSER_PROBE)
      return { inserted: true, animated: false }
    }
    typeNextCharacter()
    return { inserted: true, animated: true }
  }

  function typeNextCharacter() {
    if (!editor?.isConnected || characterCount >= CALIBRATION_COMPOSER_PROBE.length) return
    characterCount += 1
    replaceEditorText(editor, CALIBRATION_COMPOSER_PROBE.slice(0, characterCount))
    if (characterCount < CALIBRATION_COMPOSER_PROBE.length) {
      timer = setTimer(() => {
        timer = null
        typeNextCharacter()
      }, intervalMs)
    }
  }

  function cleanup() {
    if (timer !== null) clearTimer(timer)
    timer = null
    try {
      if (editor?.isConnected) replaceEditorText(editor, '')
    } finally {
      editor = null
      characterCount = 0
    }
  }

  return { activate, cleanup, isActive: () => Boolean(editor) }
}
