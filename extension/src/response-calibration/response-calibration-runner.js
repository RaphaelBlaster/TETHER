import { resolveCalibrationControls } from '../calibration/profile-validation.js'
import { executePlainTextInjection } from '../injection/content-injection.js'
import { findSubmissionRoot } from '../injection/submission-verifier.js'
import { findSmallestExactText, startMarkerCapture } from './marker-capture.js'
import { inferResponseStructure } from './structure-inference.js'

export async function runResponseCalibration({
  document,
  profile,
  requestId,
  signal,
  onProgress = () => {},
  startCapture = startMarkerCapture,
  inject = executePlainTextInjection,
  resolveControls = resolveCalibrationControls,
  findRoot = findCalibrationCaptureRoot,
  infer = inferResponseStructure,
  findExactText = findSmallestExactText,
}) {
  const samples = []
  const runToken = markerToken(requestId)
  for (let turn = 1; turn <= 3; turn += 1) {
    if (signal?.aborted) throw cancelled()
    const marker = `TETHER_CALIBRATION_${runToken}_${turn}`
    const prompt = `Reply only with: ${marker}`
    const controls = resolveControls(document, profile)
    if (!controls.validation.valid) {
      throw Object.assign(new Error('The calibrated composer is unavailable'), { code: 'calibration_invalid' })
    }
    const capture = startCapture({
      root: findRoot(controls.composer, document),
      marker,
      prompt,
      signal,
    })
    try {
      onProgress({ stage: 'injecting_marker', turn, totalTurns: 3 })
      await inject({ document, profile, text: prompt, signal })
      onProgress({ stage: 'waiting_for_marker', turn, totalTurns: 3 })
      samples.push(await capture.promise)
      onProgress({ stage: 'marker_captured', turn, totalTurns: 3 })
    } catch (error) {
      capture.cancel(error instanceof Error ? error.message : String(error))
      await capture.promise.catch(() => {})
      throw error
    }
  }
  onProgress({ stage: 'inferring_structure', turn: 3, totalTurns: 3 })
  const currentSamples = samples.map((sample) => ({
    ...sample,
    content: sample.content?.isConnected ? sample.content : findExactText(document, sample.marker),
    userContent: sample.userContent?.isConnected ? sample.userContent : findExactText(document, sample.prompt),
  }))
  let response
  try {
    response = infer({ document, samples: currentSamples })
  } catch (error) {
    error.samples = currentSamples
    throw error
  }
  onProgress({ stage: 'validated', turn: 3, totalTurns: 3 })
  return response
}

export function findCalibrationCaptureRoot(composer, document = composer?.ownerDocument) {
  return composer?.closest?.('main, [role="main"]') ?? document?.body ?? findSubmissionRoot(composer)
}

function markerToken(requestId) {
  const bounded = String(requestId).replace(/[^a-z0-9]/gi, '').slice(-20)
  return bounded || 'RUN'
}

function cancelled() {
  return Object.assign(new Error('Response calibration was cancelled'), { code: 'cancelled' })
}
