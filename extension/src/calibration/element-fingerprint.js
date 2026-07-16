export const FINGERPRINT_VERSION = 1

const STABLE_ATTRIBUTES = [
  'data-testid',
  'data-test',
  'data-qa',
  'data-message-author-role',
  'data-author',
  'name',
  'type',
  'role',
  'aria-label',
  'placeholder',
]

const DYNAMIC_TOKEN = /(?:^|[-_])(?:\d{4,}|[a-f\d]{8,})(?:$|[-_])/i
const SEMANTIC_TAGS = new Set(['main', 'article', 'section', 'p', 'blockquote', 'pre', 'body'])

function bounded(value, limit = 160) {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return normalized && normalized.length <= limit ? normalized : undefined
}

function isStableValue(value) {
  return Boolean(bounded(value)) && !DYNAMIC_TOKEN.test(value)
}

function quoteAttribute(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function attributeSelector(tagName, name, value) {
  return `${tagName}[${name}=${quoteAttribute(value)}]`
}

export function readStableAttributes(element) {
  const attributes = {}
  for (const name of STABLE_ATTRIBUTES) {
    const value = bounded(element.getAttribute?.(name))
    if (value && isStableValue(value)) attributes[name] = value
  }

  const contenteditable = element.getAttribute?.('contenteditable')
  if (contenteditable === '' || contenteditable === 'true') {
    attributes.contenteditable = 'true'
  }
  return attributes
}

function describeAncestor(element) {
  if (!element) return null
  const attributes = readStableAttributes(element)
  return {
    tagName: element.tagName?.toLowerCase(),
    role: attributes.role,
    attributes,
  }
}

export function buildCandidateSelectors(element) {
  const tagName = element.tagName.toLowerCase()
  const attributes = readStableAttributes(element)
  const selectors = []

  for (const name of STABLE_ATTRIBUTES) {
    if (attributes[name]) selectors.push(attributeSelector(tagName, name, attributes[name]))
  }
  if (attributes.contenteditable) {
    selectors.push(`${tagName}[contenteditable="true"]`, '[contenteditable="true"]')
  }
  if (
    ['button', 'textarea', 'input'].includes(tagName) ||
    SEMANTIC_TAGS.has(tagName) ||
    tagName.includes('-')
  ) selectors.push(tagName)

  return [...new Set(selectors)]
}

export function resolveFingerprint(root, fingerprint, { allowAncestorDrift = false } = {}) {
  let largestMatchCount = 0
  for (const selector of [fingerprint.primarySelector, ...fingerprint.fallbackSelectors]) {
    if (!selector) continue
    let matches
    try {
      matches = [...root.querySelectorAll(selector)]
    } catch {
      continue
    }
    const compatible = matches.filter((element) => isCompatible(element, fingerprint))
    largestMatchCount = Math.max(largestMatchCount, compatible.length)
    if (compatible.length === 1) return { element: compatible[0], selector, matchCount: 1 }
  }
  if (allowAncestorDrift) {
    for (const selector of [fingerprint.primarySelector, ...fingerprint.fallbackSelectors]) {
      if (!selector) continue
      let matches
      try {
        matches = [...root.querySelectorAll(selector)]
      } catch {
        continue
      }
      const compatible = matches.filter((element) => isCompatible(element, fingerprint, { checkAncestors: false }))
      largestMatchCount = Math.max(largestMatchCount, compatible.length)
      if (compatible.length === 1) return { element: compatible[0], selector, matchCount: 1, ancestorDrifted: true }
    }
  }
  return { element: null, selector: null, matchCount: largestMatchCount }
}

function isCompatible(element, fingerprint, { checkAncestors = true } = {}) {
  if (element.tagName?.toLowerCase() !== fingerprint.tagName) return false
  for (const [name, expected] of Object.entries(fingerprint.attributes)) {
    const actual =
      name === 'contenteditable'
        ? element.getAttribute?.(name) || (element.isContentEditable ? 'true' : null)
        : element.getAttribute?.(name)
    if (actual !== expected) return false
  }
  if (checkAncestors) {
    let ancestor = element.parentElement
    for (const expected of fingerprint.ancestorChain) {
      if (!ancestor || ancestor.tagName?.toLowerCase() !== expected.tagName) return false
      for (const [name, value] of Object.entries(expected.attributes)) {
        if (ancestor.getAttribute?.(name) !== value) return false
      }
      ancestor = ancestor.parentElement
    }
  }
  return true
}

export function createFingerprint(element, root = document) {
  if (!element?.tagName) throw new Error('A DOM element is required')

  const selectors = buildCandidateSelectors(element)
  let primarySelector = null
  let expectedMatchCount = 0
  for (const selector of selectors) {
    const matches = [...root.querySelectorAll(selector)]
    if (matches.length === 1 && matches[0] === element) {
      primarySelector = selector
      expectedMatchCount = 1
      break
    }
  }
  if (!primarySelector) throw new Error('Selected element cannot be resolved uniquely')

  const attributes = readStableAttributes(element)
  const fingerprint = {
    version: FINGERPRINT_VERSION,
    tagName: element.tagName.toLowerCase(),
    role: attributes.role ?? null,
    accessibleName: bounded(
      element.getAttribute?.('aria-label') ||
        element.getAttribute?.('title') ||
        element.innerText,
    ) ?? null,
    attributes,
    primarySelector,
    fallbackSelectors: selectors.filter((selector) => selector !== primarySelector),
    ancestorChain: [element.parentElement, element.parentElement?.parentElement]
      .map(describeAncestor)
      .filter(Boolean),
    expectedMatchCount,
  }

  if (!resolveFingerprint(root, fingerprint).element) {
    throw new Error('Selected element failed fingerprint validation')
  }
  return fingerprint
}
