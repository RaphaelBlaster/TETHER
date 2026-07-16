export class EditorWriteError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'EditorWriteError'
    this.code = code
  }
}

export function readEditorText(element) {
  const tagName = element?.tagName?.toLowerCase()
  const value = tagName === 'input' || tagName === 'textarea'
    ? element.value
    : element?.textContent
  return normalizeEditorText(value ?? '')
}

export function writeEditorText(element, text, {
  document = element?.ownerDocument,
  window = document?.defaultView,
} = {}) {
  if (typeof text !== 'string' || text.length === 0) throw new EditorWriteError('empty_text', 'A test message is required')
  return replaceEditorText(element, text, { document, window })
}

export async function writeEditorTextIncrementally(element, text, {
  document = element?.ownerDocument,
  window = document?.defaultView,
  chunkSize = 16_384,
  scheduleFrame = window?.requestAnimationFrame?.bind(window) ?? ((callback) => setTimeout(callback, 16)),
} = {}) {
  if (typeof text !== 'string' || text.length === 0) throw new EditorWriteError('empty_text', 'A test message is required')
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new EditorWriteError('invalid_chunk_size', 'Chunk size must be a positive integer')
  if (text.length <= chunkSize) return writeEditorText(element, text, { document, window })

  for (let end = chunkSize; end < text.length; end += chunkSize) {
    replaceEditorText(element, text.slice(0, end), { document, window })
    await new Promise((resolve) => scheduleFrame(resolve))
  }
  const result = replaceEditorText(element, text, { document, window })
  return { ...result, chunked: true }
}

export function replaceEditorText(element, text, {
  document = element?.ownerDocument,
  window = document?.defaultView,
} = {}) {
  if (!element?.isConnected) throw new EditorWriteError('composer_disconnected', 'The calibrated composer is no longer connected')
  if (typeof text !== 'string') throw new EditorWriteError('invalid_text', 'Editor text must be a string')

  element.focus?.({ preventScroll: true })
  const beforeInput = createInputEvent(window, 'beforeinput', text, true)
  if (!element.dispatchEvent(beforeInput)) {
    throw new EditorWriteError('beforeinput_cancelled', 'The page cancelled text insertion')
  }

  const tagName = element.tagName?.toLowerCase()
  let strategy
  if (tagName === 'input' || tagName === 'textarea') {
    writeNativeValue(element, text, window)
    strategy = 'native_value'
  } else if (element.isContentEditable || element.getAttribute?.('contenteditable') === 'true') {
    strategy = writeContentEditable(element, text, document, window)
  } else {
    throw new EditorWriteError('unsupported_editor', 'The calibrated composer is not a supported editor type')
  }

  element.dispatchEvent(createInputEvent(window, 'input', text, false))
  const actual = readEditorText(element)
  if (actual !== normalizeEditorText(text)) {
    throw new EditorWriteError('input_not_recognized', 'The page did not retain the intended test message')
  }
  return { strategy, actual }
}

function writeNativeValue(element, text, window) {
  const constructor = element.tagName?.toLowerCase() === 'textarea'
    ? window?.HTMLTextAreaElement
    : window?.HTMLInputElement
  const descriptor = constructor?.prototype
    ? Object.getOwnPropertyDescriptor(constructor.prototype, 'value')
    : null
  if (typeof descriptor?.set !== 'function') {
    throw new EditorWriteError('native_setter_missing', 'The editor native value setter is unavailable')
  }
  descriptor.set.call(element, text)
}

function writeContentEditable(element, text, document, window) {
  const selection = window?.getSelection?.()
  const range = document?.createRange?.()
  if (!selection || !range || typeof document?.createTextNode !== 'function') {
    throw new EditorWriteError('selection_unavailable', 'The browser editing selection is unavailable')
  }

  selectContents(selection, range, element)
  range.deleteContents()
  range.insertNode(document.createTextNode(text))
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)

  if (readEditorText(element) !== normalizeEditorText(text) && typeof document.execCommand === 'function') {
    selectContents(selection, range, element)
    if (!document.execCommand('insertText', false, text)) {
      throw new EditorWriteError('contenteditable_write_failed', 'The page editor rejected text insertion')
    }
    return 'contenteditable_exec_command'
  }
  return 'contenteditable_range'
}

function selectContents(selection, range, element) {
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

function createInputEvent(window, type, text, cancelable) {
  const deleting = text.length === 0
  const Options = {
    bubbles: true,
    composed: true,
    cancelable,
    inputType: deleting ? 'deleteContentBackward' : 'insertText',
    data: deleting ? null : text,
  }
  if (typeof window?.InputEvent === 'function') return new window.InputEvent(type, Options)
  return new window.Event(type, Options)
}

function normalizeEditorText(value) {
  return String(value).replaceAll('\r\n', '\n').replaceAll('\u00a0', ' ')
}
