import { executePlainTextInjection } from '../injection/content-injection.js'
import { observeNextAssistantResponse } from './response-observer.js'

export async function injectAndExtract({
  document, profile, text, signal,
  inject = executePlainTextInjection,
  observe = observeNextAssistantResponse,
}) {
  if (!profile?.responseCalibration) throw Object.assign(new Error('Response calibration is required'), { code: 'response_calibration_missing' })
  const observation = observe({
    document,
    responseCalibration: profile.responseCalibration,
    sendFingerprint: profile.send,
    composerFingerprint: profile.composer,
    expectedPrompt: text,
    signal,
  })
  try {
    let submission
    try {
      submission = await inject({ document, profile, text, signal })
    } catch (error) {
      if (error?.code !== 'submission_timeout' || error?.evidence?.clickCount !== 1) throw error
      submission = { verification: 'correlated_response', evidence: error.evidence }
    }
    const response = await observation.promise
    return { ...response, submission }
  } catch (error) {
    observation.promise.catch(() => {})
    throw error
  }
}
