import {
  buildCandidateSelectors,
  createFingerprint,
  readStableAttributes,
} from '../calibration/element-fingerprint.js'

export class ResponseInferenceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ResponseInferenceError'
    this.code = code
  }
}

export function inferResponseStructure({ document, samples }) {
  if (!Array.isArray(samples) || samples.length !== 3) {
    throw new ResponseInferenceError('sample_count', 'Exactly three response samples are required')
  }
  const contents = samples.map((sample) => sample.content)
  if (contents.some((element) => !element?.isConnected)) {
    throw new ResponseInferenceError('sample_disconnected', 'A response sample left the page before inference')
  }

  const boundaryRoot = lowestCommonAncestor(contents)
  if (!boundaryRoot || contents.includes(boundaryRoot)) {
    throw new ResponseInferenceError('conversation_root_missing', 'A narrow shared conversation root could not be inferred')
  }
  const rootResolution = nearestResolvableRoot(boundaryRoot, document)
  const conversationRoot = rootResolution.element
  const userAncestors = samples.flatMap((sample) =>
    sample.userContent ? pathUntil(sample.userContent, boundaryRoot) : [])
  const { turns, fingerprint: assistantTurn } = inferAssistantTurns({
    contents,
    boundaryRoot,
    observationRoot: conversationRoot,
    userAncestors,
  })
  const assistantContent = relativeFingerprint(contents, turns)
  const rootFingerprint = rootResolution.fingerprint
  validateSamples({ samples, conversationRoot, turns, assistantTurn, assistantContent, userTurns: userAncestors })

  return {
    version: 1,
    conversationRoot: rootFingerprint,
    assistantTurn,
    assistantContent,
    sampleCount: 3,
    calibratedAt: Date.now(),
  }
}

export function inferGuidedResponseStructure({ document, samples, selectedTurn }) {
  if (!Array.isArray(samples) || samples.length !== 3) {
    throw new ResponseInferenceError('sample_count', 'Exactly three response samples are required')
  }
  const latest = samples.at(-1)
  if (!selectedTurn?.isConnected || !selectedTurn.contains(latest.content)) {
    throw new ResponseInferenceError('guided_turn_invalid', 'Select the complete assistant response containing the latest marker')
  }
  if (selectedTurn.contains(latest.userContent)) {
    throw new ResponseInferenceError('guided_turn_contains_prompt', 'The selection also contains the submitted prompt; choose a narrower response card')
  }
  const ancestorDepth = distanceToAncestor(latest.content, selectedTurn)
  const turns = samples.map((sample) => climb(sample.content, ancestorDepth))
  if (turns.some((turn) => !turn?.isConnected) || new Set(turns).size !== 3) {
    throw new ResponseInferenceError('guided_turn_mismatch', 'The same response-card boundary does not exist for all three samples')
  }
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]
    if (!turn.contains(samples[index].content) || turn.contains(samples[index].userContent)) {
      throw new ResponseInferenceError('guided_turn_mismatch', 'The selected boundary does not separate assistant responses from user prompts')
    }
    if (samples.some((sample, other) => other !== index && normalize(turn.textContent).includes(sample.marker))) {
      throw new ResponseInferenceError('guided_turn_multiple_markers', 'One selected response card contains more than one calibration marker')
    }
  }
  const boundaryRoot = lowestCommonAncestor(turns)
  if (!boundaryRoot || turns.includes(boundaryRoot)) {
    throw new ResponseInferenceError('conversation_root_missing', 'A shared conversation root could not be inferred from the selected responses')
  }
  const rootResolution = nearestResolvableRoot(boundaryRoot, document)
  return {
    version: 1,
    conversationRoot: rootResolution.fingerprint,
    assistantTurn: guidedFingerprint(selectedTurn, 'content_ancestor', { ancestorDepth, expectedMatchCount: 3 }),
    assistantContent: guidedFingerprint(latest.content, 'relative_path', {
      expectedMatchCount: 1,
      path: relativeElementPath(selectedTurn, latest.content),
    }),
    sampleCount: 3,
    calibratedAt: Date.now(),
    inferenceMode: 'guided',
  }
}

function guidedFingerprint(element, resolution, extra) {
  return {
    version: 1,
    resolution,
    tagName: element.tagName.toLowerCase(),
    attributes: readStableAttributes(element),
    primarySelector: element.tagName.toLowerCase(),
    fallbackSelectors: buildCandidateSelectors(element),
    ...extra,
  }
}

function distanceToAncestor(element, ancestor) {
  let depth = 0
  for (let node = element; node && node !== ancestor; node = node.parentElement) depth += 1
  return depth
}

function climb(element, depth) {
  let node = element
  for (let index = 0; index < depth; index += 1) node = node?.parentElement
  return node
}

function relativeElementPath(ancestor, descendant) {
  const reversed = []
  for (let node = descendant; node && node !== ancestor; node = node.parentElement) {
    const siblings = [...(node.parentElement?.children ?? [])].filter((candidate) => candidate.tagName === node.tagName)
    reversed.push({ tagName: node.tagName.toLowerCase(), sameTagIndex: siblings.indexOf(node) })
  }
  return reversed.reverse()
}

function inferAssistantTurns({ contents, boundaryRoot, observationRoot, userAncestors }) {
  const paths = contents.map((content) => pathUntil(content, boundaryRoot))
  const maxSharedDepth = Math.min(...paths.map((path) => path.length))
  for (let depth = maxSharedDepth - 1; depth >= 0; depth -= 1) {
    const turns = paths.map((path) => path[depth])
    if (new Set(turns).size !== contents.length) continue
    try {
      return {
        turns,
        fingerprint: repeatedFingerprint(turns, observationRoot, userAncestors),
      }
    } catch (error) {
      if (error?.code !== 'assistant_turn_ambiguous') throw error
    }
  }
  throw new ResponseInferenceError('assistant_turn_ambiguous', 'Assistant turns cannot be separated structurally from user turns')
}

function pathUntil(element, boundary) {
  const path = []
  for (let node = element; node && node !== boundary; node = node.parentElement) path.push(node)
  return path
}

function nearestResolvableRoot(start, document) {
  for (let element = start; element; element = element.parentElement) {
    try {
      return { element, fingerprint: createFingerprint(element, document) }
    } catch {
      // Anonymous layout wrappers are skipped in favor of a stable semantic ancestor.
    }
  }
  throw new ResponseInferenceError('conversation_root_unresolvable', 'No stable conversation observation root could be resolved')
}

function repeatedFingerprint(elements, root, excluded) {
  const selector = buildCandidateSelectors(elements[0]).find((candidate) => {
    const matches = safeMatches(root, candidate)
    return elements.every((element) => matches.includes(element)) &&
      excluded.every((element) => !matches.includes(element))
  })
  if (!selector) {
    throw new ResponseInferenceError('assistant_turn_ambiguous', 'Assistant turns cannot be separated structurally from user turns')
  }
  return structuralFingerprint(elements[0], selector, safeMatches(root, selector).length)
}

function relativeFingerprint(elements, turns) {
  const selector = buildCandidateSelectors(elements[0]).find((candidate) =>
    turns.every((turn, index) => {
      const matches = safeMatches(turn, candidate)
      return matches.length === 1 && matches[0] === elements[index]
    }))
  if (!selector) {
    throw new ResponseInferenceError('assistant_content_ambiguous', 'Assistant content cannot be resolved uniquely inside each turn')
  }
  return structuralFingerprint(elements[0], selector, 1)
}

function structuralFingerprint(element, primarySelector, expectedMatchCount) {
  return {
    version: 1,
    tagName: element.tagName.toLowerCase(),
    attributes: readStableAttributes(element),
    primarySelector,
    fallbackSelectors: buildCandidateSelectors(element).filter((selector) => selector !== primarySelector),
    expectedMatchCount,
  }
}

function validateSamples({ samples, conversationRoot, turns, assistantTurn, assistantContent, userTurns }) {
  const turnMatches = safeMatches(conversationRoot, assistantTurn.primarySelector)
  for (let index = 0; index < samples.length; index += 1) {
    if (!turnMatches.includes(turns[index])) {
      throw new ResponseInferenceError('turn_validation_failed', 'An inferred assistant turn failed validation')
    }
    const contentMatches = safeMatches(turns[index], assistantContent.primarySelector)
    if (contentMatches.length !== 1 || contentMatches[0] !== samples[index].content) {
      throw new ResponseInferenceError('content_validation_failed', 'An inferred assistant content node failed validation')
    }
    if (samples.some((sample, markerIndex) =>
      markerIndex !== index && normalize(turns[index].textContent).includes(sample.marker))) {
      throw new ResponseInferenceError('turn_contains_multiple_samples', 'One inferred turn contains multiple calibration responses')
    }
  }
  if (userTurns.some((turn) => turnMatches.includes(turn))) {
    throw new ResponseInferenceError('user_turn_matched', 'The assistant fingerprint also matches a submitted user turn')
  }
}

function lowestCommonAncestor(elements) {
  const firstAncestors = ancestors(elements[0])
  return firstAncestors.find((candidate) => elements.every((element) => candidate.contains(element))) ?? null
}

function ancestors(element) {
  const result = []
  for (let node = element; node; node = node.parentElement) result.push(node)
  return result
}

function safeMatches(root, selector) {
  try {
    return [...root.querySelectorAll(selector)]
  } catch {
    return []
  }
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
