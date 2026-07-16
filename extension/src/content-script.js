import { CALIBRATION_STAGE, createCalibrationController } from './calibration/calibration-controller.js'
import { createComposerProbe } from './calibration/composer-probe.js'
import { createElementInspector } from './calibration/element-inspector.js'
import { normalizeCalibrationTarget } from './calibration/target-normalizer.js'
import { validateCalibrationProfile } from './calibration/profile-validation.js'
import { executePlainTextInjection } from './injection/content-injection.js'
import { runResponseCalibration } from './response-calibration/response-calibration-runner.js'
import { inferGuidedResponseStructure } from './response-calibration/structure-inference.js'
import { injectAndExtract } from './extraction/prompt-extraction.js'

  const CONTENT_SCRIPT_VERSION = 34

if (globalThis.__tetherCalibrationVersion !== CONTENT_SCRIPT_VERSION) {
  try { globalThis.__tetherContentScriptCleanup?.() } catch (error) { void error }
  globalThis.__tetherCalibrationVersion = CONTENT_SCRIPT_VERSION
  const controller = createCalibrationController()
  const composerProbe = createComposerProbe()
  let runtimeWatchdog = null
  let activeRequestId = null
  let activeInjection = null
  let settledInjection = null
  let activeResponseCalibration = null
  let guidedResponseContext = null
  let activeExtraction = null
  let responseCalibrationState = { stage: 'idle', requestId: null, browserSessionId: null, turn: 0, totalTurns: 3 }
  let tetherEndpointState = 'hidden'

  const stopRuntimeWatchdog = () => {
    if (runtimeWatchdog !== null) clearInterval(runtimeWatchdog)
    runtimeWatchdog = null
  }

  const startRuntimeWatchdog = () => {
    stopRuntimeWatchdog()
    runtimeWatchdog = setInterval(() => {
      if (!chrome.runtime?.id) {
        composerProbe.cleanup()
        inspector.stop()
        responseInspector.stop()
        activeInjection?.controller.abort()
        activeResponseCalibration?.controller.abort()
        activeInjection = null
        activeResponseCalibration = null
        stopRuntimeWatchdog()
      }
    }, 1000)
  }

  const report = (detail, requestId = activeRequestId) =>
    chrome.runtime.sendMessage({ type: 'calibration.pageState', requestId, ...detail })
  const inspector = createElementInspector({
    document,
    window,
    onConfirm(element) {
      const result = controller.confirm(element)
      if (result.stage === CALIBRATION_STAGE.SELECTING_SEND) {
        composerProbe.activate(element)
        report(result)
        inspector.start(
          'Select the Send button, then press Enter to confirm',
          (element) => normalizeCalibrationTarget(element, 'send'),
        )
      } else {
        composerProbe.cleanup()
        inspector.stop()
        stopRuntimeWatchdog()
        const requestId = activeRequestId
        activeRequestId = null
        report(result, requestId)
      }
    },
    onCancel() {
      composerProbe.cleanup()
      stopRuntimeWatchdog()
      const requestId = activeRequestId
      activeRequestId = null
      report(controller.cancel(), requestId)
    },
    onError(error) {
      report({
        stage: 'selection_rejected',
        calibrationStage: controller.snapshot().stage,
        error: error.message,
      })
    },
  })
  const responseInspector = createElementInspector({
    document,
    window,
    onConfirm(element) {
      const responseCalibration = inferGuidedResponseStructure({
        document,
        samples: guidedResponseContext.samples,
        selectedTurn: element,
      })
      responseInspector.stop()
      const identity = guidedResponseContext.identity
      guidedResponseContext = null
      responseCalibrationState = { ...responseCalibrationState, ...identity, stage: 'complete', responseCalibration, error: null }
      chrome.runtime.sendMessage({ type: 'responseCalibration.pageState', ...responseCalibrationState }).catch(() => {})
      activeResponseCalibration = null
      stopRuntimeWatchdog()
    },
    onCancel() {
      responseInspector.stop()
      const identity = guidedResponseContext?.identity ?? {}
      guidedResponseContext = null
      activeResponseCalibration = null
      responseCalibrationState = { ...responseCalibrationState, ...identity, stage: 'cancelled', code: 'cancelled', error: 'Guided response calibration was cancelled' }
      chrome.runtime.sendMessage({ type: 'responseCalibration.pageState', ...responseCalibrationState }).catch(() => {})
      stopRuntimeWatchdog()
    },
    onError() {},
  })

  const handleRuntimeMessage = (message, _sender, sendResponse) => {
    if (message?.type === 'tether.endpointState') {
      tetherEndpointState = message.state
      sendResponse({ ok: true, state: tetherEndpointState })
    } else if (message?.type === 'tether.endpointReady') {
      sendResponse({ ok: true, version: CONTENT_SCRIPT_VERSION, visibility: document.visibilityState })
    } else if (message?.type === 'calibration.start') {
      if (activeResponseCalibration) {
        sendResponse({ ok: false, error: 'Response calibration is active in this tab' })
        return
      }
      if (activeRequestId) {
        if (activeRequestId === message.requestId) {
          sendResponse({ ok: true, duplicate: true, stage: controller.snapshot().stage })
        } else {
          sendResponse({ ok: false, error: 'Another calibration is already active in this tab' })
        }
        return
      }
      activeRequestId = message.requestId
      const result = controller.start()
      startRuntimeWatchdog()
      inspector.start(
        'Select the message box where you type, then press Enter to confirm',
        (element) => normalizeCalibrationTarget(element, 'composer'),
      )
      report(result)
      sendResponse({ ok: true, stage: result.stage })
    } else if (message?.type === 'calibration.cancel') {
      if (activeRequestId && message.requestId && message.requestId !== activeRequestId) {
        sendResponse({ ok: false, error: 'Calibration request does not own this overlay' })
        return
      }
      composerProbe.cleanup()
      inspector.stop()
      stopRuntimeWatchdog()
      const requestId = activeRequestId
      activeRequestId = null
      report(controller.cancel(), requestId)
      sendResponse({ ok: true })
    } else if (message?.type === 'calibration.getPageState') {
      sendResponse({ ...controller.snapshot(), requestId: activeRequestId, active: inspector.isActive() })
    } else if (message?.type === 'calibration.validateProfile') {
      sendResponse(validateCalibrationProfile(document, message.profile))
    } else if (message?.type === 'injection.execute') {
      if (location.origin !== message.origin) {
        sendResponse({ ok: false, code: 'origin_mismatch', error: 'The page origin does not match the browser session' })
        return
      }
      if (activeRequestId) {
        sendResponse({ ok: false, code: 'calibration_active', error: 'Calibration is active in this tab' })
        return
      }
      if (activeResponseCalibration) {
        sendResponse({ ok: false, code: 'response_calibration_active', error: 'Response calibration is active in this tab' })
        return
      }
      if (settledInjection?.requestId === message.requestId) {
        sendResponse(settledInjection.response)
        return
      }
      if (activeInjection) {
        if (activeInjection.requestId !== message.requestId) {
          sendResponse({ ok: false, code: 'injection_busy', error: 'Another test-message injection is active in this tab' })
          return
        }
        activeInjection.promise.then(sendResponse)
        return true
      }

      const controller = new AbortController()
      const promise = executePlainTextInjection({
        document,
        profile: message.profile,
        text: message.text,
        signal: controller.signal,
      }).then(
        (result) => ({ ok: true, result }),
        (error) => ({
          ok: false,
          code: error?.code ?? 'injection_failed',
          error: error instanceof Error ? error.message : String(error),
          evidence: error?.evidence ?? null,
        }),
      ).then((response) => {
        settledInjection = { requestId: message.requestId, response }
        return response
      }).finally(() => {
        if (activeInjection?.requestId === message.requestId) activeInjection = null
      })
      activeInjection = { requestId: message.requestId, browserSessionId: message.browserSessionId, controller, promise }
      promise.then(sendResponse)
      return true
    } else if (message?.type === 'injection.cancel') {
      if (!activeInjection || activeInjection.requestId !== message.requestId) {
        sendResponse({ ok: true, cancelled: false })
        return
      }
      activeInjection.controller.abort()
      sendResponse({ ok: true, cancelled: true })
    } else if (message?.type === 'responseCalibration.start') {
      if (location.origin !== message.origin) {
        sendResponse({ ok: false, code: 'origin_mismatch', error: 'The page origin does not match the browser session' })
        return
      }
      if (activeRequestId || activeInjection) {
        sendResponse({ ok: false, code: 'page_busy', error: 'Another TETHER page operation is active' })
        return
      }
      if (activeResponseCalibration) {
        if (activeResponseCalibration.requestId === message.requestId) {
          sendResponse({ ok: true, duplicate: true, stage: responseCalibrationState.stage })
        } else {
          sendResponse({ ok: false, code: 'response_calibration_busy', error: 'Another response calibration is active' })
        }
        return
      }
      const controller = new AbortController()
      const identity = { requestId: message.requestId, browserSessionId: message.browserSessionId }
      const publishResponseState = (patch) => {
        responseCalibrationState = { ...responseCalibrationState, ...identity, ...patch }
        chrome.runtime.sendMessage({ type: 'responseCalibration.pageState', ...responseCalibrationState }).catch(() => {})
      }
      responseCalibrationState = { ...identity, stage: 'starting', turn: 0, totalTurns: 3, error: null }
      const promise = runResponseCalibration({
        document,
        profile: message.profile,
        requestId: message.requestId,
        signal: controller.signal,
        onProgress: publishResponseState,
      }).then(
        (responseCalibration) => publishResponseState({ stage: 'complete', responseCalibration, error: null }),
        (error) => {
          if (!controller.signal.aborted && Array.isArray(error?.samples) && error.samples.length === 3) {
            guidedResponseContext = { identity, samples: error.samples }
            publishResponseState({
              stage: 'manual_selection_required',
              code: error?.code ?? 'automatic_inference_failed',
              error: error instanceof Error ? error.message : String(error),
            })
            return
          }
          publishResponseState({
            stage: controller.signal.aborted ? 'cancelled' : 'failed',
            code: error?.code ?? 'response_calibration_failed',
            error: error instanceof Error ? error.message : String(error),
          })
        },
      ).finally(() => {
        if (!guidedResponseContext && activeResponseCalibration?.requestId === message.requestId) activeResponseCalibration = null
        if (!guidedResponseContext) stopRuntimeWatchdog()
      })
      activeResponseCalibration = { ...identity, controller, promise }
      startRuntimeWatchdog()
      sendResponse({ ok: true, stage: 'starting' })
    } else if (message?.type === 'responseCalibration.manualSelect') {
      if (!guidedResponseContext || guidedResponseContext.identity.requestId !== message.requestId) {
        sendResponse({ ok: false, code: 'manual_selection_unavailable', error: 'The captured response samples are no longer available' })
        return
      }
      responseCalibrationState = { ...responseCalibrationState, stage: 'manual_selecting_turn', error: null }
      chrome.runtime.sendMessage({ type: 'responseCalibration.pageState', ...responseCalibrationState }).catch(() => {})
      responseInspector.start('Select the complete latest assistant response card, then press Enter to confirm')
      sendResponse({ ok: true, stage: 'manual_selecting_turn' })
    } else if (message?.type === 'responseCalibration.cancel') {
      if (!activeResponseCalibration || activeResponseCalibration.requestId !== message.requestId) {
        sendResponse({ ok: true, cancelled: false })
        return
      }
      activeResponseCalibration.controller.abort()
      responseInspector.stop()
      guidedResponseContext = null
      sendResponse({ ok: true, cancelled: true })
    } else if (message?.type === 'responseCalibration.getPageState') {
      sendResponse(responseCalibrationState)
    } else if (message?.type === 'extraction.execute.v2') {
      if (location.origin !== message.origin || activeRequestId || activeInjection || activeResponseCalibration) {
        sendResponse({ ok: false, code: 'page_busy', error: 'This tab cannot start response extraction right now' })
        return
      }
      if (activeExtraction) {
        if (activeExtraction.requestId !== message.requestId) {
          sendResponse({ ok: false, code: 'extraction_busy', error: 'Another extraction test is active in this tab' })
          return
        }
        activeExtraction.promise.then(sendResponse)
        return true
      }
      const controller = new AbortController()
      const promise = injectAndExtract({ document, profile: message.profile, text: message.text, signal: controller.signal }).then(
        (result) => ({ ok: true, result }),
        (error) => ({
          ok: false,
          code: error?.code ?? 'extraction_failed',
          error: `${error?.tetherStage ? `[${error.tetherStage}] ` : ''}${error instanceof Error ? error.message : String(error)}`,
        }),
      ).finally(() => { activeExtraction = null })
      activeExtraction = { requestId: message.requestId, controller, promise }
      promise.then(sendResponse)
      return true
    } else if (message?.type === 'extraction.cancel.v2') {
      const cancelled = Boolean(activeExtraction)
      activeExtraction?.controller.abort()
      sendResponse({ ok: true, cancelled })
    }
  }

  chrome.runtime.onMessage.addListener(handleRuntimeMessage)
  globalThis.__tetherContentScriptCleanup = () => {
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
    composerProbe.cleanup()
    inspector.stop()
    responseInspector.stop()
    activeInjection?.controller.abort()
    activeResponseCalibration?.controller.abort()
    activeExtraction?.controller.abort()
    activeInjection = null
    activeResponseCalibration = null
    activeExtraction = null
    guidedResponseContext = null
    stopRuntimeWatchdog()
    tetherEndpointState = 'hidden'
  }
}
