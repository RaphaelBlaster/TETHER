import { CALIBRATION_STAGE, createCalibrationController } from './calibration/calibration-controller.js'
import { createComposerProbe } from './calibration/composer-probe.js'
import { createElementInspector } from './calibration/element-inspector.js'
import { normalizeCalibrationTarget } from './calibration/target-normalizer.js'
import { validateCalibrationProfile } from './calibration/profile-validation.js'
import { executePlainTextInjection } from './injection/content-injection.js'
import { runResponseCalibration } from './response-calibration/response-calibration-runner.js'
import { inferGuidedResponseStructure } from './response-calibration/structure-inference.js'
import { injectAndExtract } from './extraction/prompt-extraction.js'

  const CONTENT_SCRIPT_VERSION = 38

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
  let endpointGuard = null
  let endpointGuardBypass = false
  let blockedInteractions = 0
  let guardRemovalTimer = null
  let deferredGuardRelease = false
  let endpointGuardTheme = 'dark'

  const GUARD_EXIT_MS = 600

  const normalizeEndpointGuardTheme = (theme) => theme === 'light' ? 'light' : 'dark'
  const applyEndpointGuardTheme = (theme) => {
    endpointGuardTheme = normalizeEndpointGuardTheme(theme)
    endpointGuard?.setTheme(endpointGuardTheme)
  }
  const guardEvents = ['pointerdown', 'click', 'dblclick', 'contextmenu', 'keydown', 'wheel', 'touchstart']

  const guardInteraction = (event) => {
    if (!endpointGuard || endpointGuardBypass) return
    event.preventDefault()
    event.stopImmediatePropagation()
    blockedInteractions += 1
    const x = Number.isFinite(event.clientX) ? event.clientX : innerWidth / 2
    const y = Number.isFinite(event.clientY) ? event.clientY : innerHeight / 2
    endpointGuard.react(x, y, blockedInteractions)
    chrome.runtime.sendMessage({ type: 'tether.overlay.interaction', count: blockedInteractions }).catch(() => {})
  }

  const removeEndpointGuard = () => {
    if (guardRemovalTimer !== null) clearTimeout(guardRemovalTimer)
    guardRemovalTimer = null
    deferredGuardRelease = false
    if (!endpointGuard) return
    guardEvents.forEach((type) => document.removeEventListener(type, guardInteraction, true))
    endpointGuard.host.remove()
    endpointGuard = null
    endpointGuardBypass = false
    blockedInteractions = 0
  }

  const createEndpointGuard = () => {
    if (endpointGuard) return endpointGuard
    const host = document.createElement('div')
    host.id = 'tether-endpoint-guard-v1'
    host.setAttribute('aria-hidden', 'true')
    host.dataset.theme = endpointGuardTheme
    Object.assign(host.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
    })
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        .guard { --guard-ink: #f3efe4; --guard-muted: #aaa69b; --guard-card: rgba(23,23,20,.92); --guard-card-solid: #171714; --guard-border: rgba(243,239,228,.3); --guard-soft-border: rgba(243,239,228,.14); --guard-soft-fill: rgba(243,239,228,.045); --guard-chip: rgba(243,239,228,.1); --guard-route: rgba(243,239,228,.3); --guard-grid: rgba(255,255,255,.055); --guard-veil: rgba(18,18,16,.5); --guard-icon-bg: #f3efe4; --guard-icon-ink: #171714; position: fixed; inset: 0; isolation: isolate; display: grid; place-items: center; overflow: hidden; color: var(--guard-ink); background: transparent; font-family: Arial, sans-serif; }
        :host([data-theme='light']) .guard { --guard-ink: #171714; --guard-muted: #69675f; --guard-card: rgba(250,247,239,.94); --guard-card-solid: #faf7ef; --guard-border: rgba(23,23,20,.3); --guard-soft-border: rgba(23,23,20,.14); --guard-soft-fill: rgba(23,23,20,.045); --guard-chip: rgba(23,23,20,.09); --guard-route: rgba(23,23,20,.28); --guard-grid: rgba(243,239,228,.09); --guard-veil: rgba(23,23,20,.3); --guard-icon-bg: #171714; --guard-icon-ink: #f3efe4; }
        .guard::after { position: absolute; z-index: 0; inset: 0; content: ''; background: var(--guard-veil); backdrop-filter: blur(7px) saturate(.72); clip-path: circle(0 at 50% 50%); animation: blur-field-in .68s .52s cubic-bezier(.33,1,.68,1) both; transition: background .28s ease; }
        .guard::before { position: absolute; z-index: 1; inset: 0; opacity: 0; content: ''; background-image: linear-gradient(var(--guard-grid) 1px, transparent 1px), linear-gradient(90deg, var(--guard-grid) 1px, transparent 1px); background-size: 44px 44px; mask-image: linear-gradient(to bottom, transparent, black 24%, black 76%, transparent); transform: scale(1.015); animation: grid-in .24s .26s ease-out both; }
        .card { position: relative; z-index: 2; width: min(370px, calc(100vw - 36px)); padding: 19px; opacity: 0; border: 1px solid var(--guard-border); background: var(--guard-card); box-shadow: 8px 8px 0 #f05a2a, 0 24px 80px rgba(0,0,0,.35); transform: translateY(14px) scale(.985); animation: card-in .28s .04s cubic-bezier(.22,1,.36,1) both; transition: color .28s ease, border-color .28s ease, background .28s ease; }
        .top { display: flex; align-items: center; justify-content: space-between; color: var(--guard-muted); font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
        .brand { display: flex; align-items: center; gap: 8px; color: var(--guard-ink); }
        .mini-mark { position: relative; width: 26px; height: 17px; flex: 0 0 auto; }
        .mini-mark::before, .mini-mark::after { position: absolute; top: 1px; z-index: 1; width: 10px; height: 10px; border-radius: 50%; content: ''; }
        .mini-mark::before { left: 0; border: 2px solid var(--guard-ink); background: var(--guard-card-solid); }
        .mini-mark::after { right: 0; background: #f05a2a; }
        .mini-mark i { position: absolute; top: 5px; left: 8px; width: 11px; height: 2px; background: var(--guard-ink); transform: rotate(-12deg); }
        .mini-mark b { position: absolute; top: 6px; left: 13px; width: 2px; height: 9px; border-radius: 99px; background: var(--guard-ink); }
        .endpoint-context { display: grid; grid-template-columns: 38px minmax(0,1fr) auto; align-items: center; gap: 11px; margin: 24px 0 22px; padding: 12px; border: 1px solid var(--guard-soft-border); background: var(--guard-soft-fill); transition: border-color .28s ease, background .28s ease; }
        .site-icon { display: grid; width: 38px; height: 38px; place-items: center; overflow: hidden; color: var(--guard-icon-ink); background: var(--guard-icon-bg); font: 700 17px Georgia, serif; transition: color .28s ease, background .28s ease; }
        .site-icon img { width: 24px; height: 24px; object-fit: contain; }
        .site-copy { display: grid; min-width: 0; gap: 2px; }
        .site-copy > span, .site-mode { color: var(--guard-muted); font-size: 7px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        .site-copy strong { overflow: hidden; color: var(--guard-ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .site-copy small { overflow: hidden; color: var(--guard-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
        .site-mode { padding: 6px 7px; color: var(--guard-ink); background: var(--guard-chip); }
        h2 { margin: 0 0 9px; color: var(--guard-ink); font: 400 32px/1 Georgia, serif; letter-spacing: -.04em; }
        p { margin: 0; color: var(--guard-muted); font: 12px/1.5 Arial, sans-serif; }
        .route { position: relative; height: 34px; margin-top: 25px; }
        .route::before { position: absolute; top: 16px; right: 12px; left: 12px; height: 2px; content: ''; background: var(--guard-route); }
        .node { position: absolute; top: 9px; width: 16px; height: 16px; border: 2px solid var(--guard-ink); border-radius: 50%; background: var(--guard-card-solid); }
        .node.a { left: 4px; } .node.b { right: 4px; border-color: #f05a2a; background: #f05a2a; }
        .signal { position: absolute; top: 14px; left: 19px; width: 7px; height: 7px; border-radius: 50%; background: #f05a2a; animation: travel 2s ease-in-out infinite; }
        .attempt { min-height: 15px; margin-top: 15px; color: #f05a2a; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .top, .brand, .mini-mark::before, .mini-mark i, .mini-mark b, .site-copy > span, .site-copy strong, .site-copy small, .site-mode, h2, p, .route::before, .node { transition: color .28s ease, border-color .28s ease, background .28s ease; }
        .ripple { position: fixed; z-index: 3; width: 20px; height: 20px; margin: -10px; border: 2px solid #f05a2a; border-radius: 50%; animation: ripple .55s ease-out forwards; }
        .guard.is-releasing .card { animation: card-out .18s ease-in both; }
        .guard.is-releasing::before { animation: grid-out .26s .2s ease-in both; }
        .guard.is-releasing::after { animation: blur-field-out .3s .2s cubic-bezier(.55,0,1,.45) both; }
        @keyframes card-in { to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes grid-in { to { opacity: 1; transform: scale(1); } }
        @keyframes blur-field-in { to { clip-path: circle(150vmax at 50% 50%); } }
        @keyframes grid-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(.99); } }
        @keyframes blur-field-out { from { clip-path: circle(150vmax at 50% 50%); } to { clip-path: circle(0 at 50% 50%); } }
        @keyframes card-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(10px) scale(.985); } }
        @keyframes travel { from { transform: translateX(0); opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } to { transform: translateX(255px); opacity: 0; } }
        @keyframes ripple { to { transform: scale(4.5); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition: none !important; } }
      </style>
      <div class="guard">
        <section class="card">
          <div class="top"><span class="brand"><span class="mini-mark"><i></i><b></b></span>TETHER</span><span>Tab protected</span></div>
          <div class="endpoint-context">
            <span class="site-icon"><img alt="" hidden><b>?</b></span>
            <span class="site-copy"><span>Protected endpoint</span><strong>Current browser tab</strong><small></small></span>
            <span class="site-mode">CLI</span>
          </div>
          <h2>This page is tethered.</h2>
          <p>Codex owns this browser endpoint. Deactivate TETHER from the side panel to restore normal interaction.</p>
          <div class="route"><span class="node a"></span><span class="signal"></span><span class="node b"></span></div>
          <div class="attempt" role="status">Interaction guard active</div>
        </section>
      </div>`
    document.documentElement.append(host)
    const guard = shadow.querySelector('.guard')
    const attempt = shadow.querySelector('.attempt')
    const siteImage = shadow.querySelector('.site-icon img')
    const siteFallback = shadow.querySelector('.site-icon b')
    const siteTitle = shadow.querySelector('.site-copy strong')
    const siteHost = shadow.querySelector('.site-copy small')
    const siteMode = shadow.querySelector('.site-mode')
    endpointGuard = {
      host,
      releasing: false,
      setTheme(theme) {
        host.dataset.theme = normalizeEndpointGuardTheme(theme)
      },
      updateContext(context = {}) {
        const title = context.title || 'Current browser tab'
        siteTitle.textContent = title
        siteHost.textContent = context.host || location.hostname
        siteMode.textContent = context.mode === 'CROSS' ? 'CROSS' : 'CLI'
        siteFallback.textContent = title.trim().slice(0, 1).toUpperCase() || 'T'
        if (context.faviconUrl) {
          siteImage.hidden = false
          siteFallback.hidden = true
          siteImage.onerror = () => { siteImage.hidden = true; siteFallback.hidden = false }
          siteImage.src = context.faviconUrl
        } else {
          siteImage.hidden = true
          siteFallback.hidden = false
          siteImage.removeAttribute('src')
        }
      },
      reset() {
        this.releasing = false
        guard.classList.remove('is-releasing')
        attempt.textContent = blockedInteractions ? `${blockedInteractions} interaction${blockedInteractions === 1 ? '' : 's'} blocked · deactivate in the panel` : 'Interaction guard active'
      },
      release() {
        this.releasing = true
        attempt.textContent = 'Releasing page interaction'
        guard.classList.add('is-releasing')
      },
      react(x, y, count) {
        if (this.releasing) return
        const ripple = document.createElement('span')
        ripple.className = 'ripple'
        ripple.style.left = `${x}px`
        ripple.style.top = `${y}px`
        guard.append(ripple)
        setTimeout(() => ripple.remove(), 600)
        attempt.textContent = `${count} interaction${count === 1 ? '' : 's'} blocked · deactivate in the panel`
      },
    }
    guardEvents.forEach((type) => document.addEventListener(type, guardInteraction, { capture: true, passive: false }))
    return endpointGuard
  }

  const beginEndpointGuardRelease = () => {
    if (!endpointGuard) return
    if (document.visibilityState !== 'visible') {
      deferredGuardRelease = true
      return
    }
    deferredGuardRelease = false
    endpointGuard.release()
    if (guardRemovalTimer !== null) clearTimeout(guardRemovalTimer)
    guardRemovalTimer = setTimeout(removeEndpointGuard, GUARD_EXIT_MS)
  }

  const handleGuardVisibilityChange = () => {
    if (document.visibilityState === 'visible' && deferredGuardRelease) beginEndpointGuardRelease()
  }

  document.addEventListener('visibilitychange', handleGuardVisibilityChange)

  const setEndpointGuardState = (state, context = {}) => {
    if (state === 'hidden') {
      tetherEndpointState = state
      removeEndpointGuard()
      return
    }
    if (endpointGuard?.releasing && state !== 'releasing') return
    tetherEndpointState = state
    endpointGuardBypass = state === 'automation'
    const guard = createEndpointGuard()
    guard.updateContext(context)
    if (state === 'releasing') {
      endpointGuardBypass = false
      beginEndpointGuardRelease()
      return
    }
    if (guardRemovalTimer !== null) clearTimeout(guardRemovalTimer)
    guardRemovalTimer = null
    deferredGuardRelease = false
    guard.reset()
  }

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
      applyEndpointGuardTheme(message.theme)
      setEndpointGuardState(message.state, { ...message.context, mode: message.mode })
      sendResponse({ ok: true, state: tetherEndpointState })
    } else if (message?.type === 'tether.theme.set') {
      applyEndpointGuardTheme(message.theme)
      sendResponse({ ok: true, theme: endpointGuardTheme })
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
    document.removeEventListener('visibilitychange', handleGuardVisibilityChange)
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
    setEndpointGuardState('hidden')
  }
}
