import './App.css'
import React from 'react'
import Silk from './Silk'
import RotatingText from './components/RotatingText'
import OptionWheel from './components/OptionWheel'
import { requestCalibrationAccess } from './calibration/calibration-access.js'
import { SIDE_PANEL_PORT } from './calibration/panel-lifecycle.js'
import { projectCalibrationStatus, projectPrimaryStatus } from './panel-state-model.js'

const CALIBRATION_PROGRESS = {
  starting: 'Preparing the calibration inspector…',
  selecting_composer: 'On the page, select the message box where you type.',
  selecting_send: 'Composer saved. Now select the Send control.',
}

function useConnectionState() {
  const [state, setState] = React.useState('unavailable')
  React.useEffect(() => {
    if (!globalThis.chrome?.runtime) return undefined
    const listener = (message) => {
      if (message?.type === 'connection.stateChanged') setState(message.state)
    }
    chrome.runtime.onMessage.addListener(listener)
    chrome.runtime.sendMessage({ type: 'connection.getState' })
      .then((response) => setState(response?.state ?? 'unavailable'))
      .catch(() => setState('unavailable'))
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])
  return state
}

function usePanelState() {
  const [state, setState] = React.useState({ access: 'loading' })
  const requestSequence = React.useRef(0)
  const refresh = React.useCallback(async () => {
    const sequence = ++requestSequence.current
    const response = await chrome.runtime.sendMessage({ type: 'panel.getState' })
    if (!response?.ok) throw new Error(response?.error ?? 'TETHER state is unavailable')
    if (sequence === requestSequence.current) setState(response.state)
    return response.state
  }, [])
  const resetForTab = React.useCallback(() => {
    requestSequence.current += 1
    setState({ access: 'loading' })
  }, [])

  React.useEffect(() => {
    if (!globalThis.chrome?.runtime) return undefined
    const listener = (message) => {
      if (['panel.stateChanged', 'browserSession.stateChanged', 'calibration.stateChanged', 'injection.stateChanged', 'responseCalibration.stateChanged', 'extraction.stateChanged'].includes(message?.type)) {
        refresh().catch(() => {})
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    queueMicrotask(() => refresh().catch((error) => setState({ access: 'error', error: error.message })))
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [refresh])

  return [state, setState, refresh, resetForTab]
}

function App() {
  const connectionState = useConnectionState()
  const [panelState, setPanelState, refreshPanelState, resetPanelForTab] = usePanelState()
  const [startPending, setStartPending] = React.useState(false)
  const startPendingRef = React.useRef(false)
  const [testMessage, setTestMessage] = React.useState('')
  const injectionPendingRef = React.useRef(false)
  const responseCalibrationPendingRef = React.useRef(false)
  const modeTextRef = React.useRef(null)
  const modeMenuRef = React.useRef(null)
  const crossRoleMenuRef = React.useRef(null)
  const [mode, setMode] = React.useState('CLI')
  const [modeMenuOpen, setModeMenuOpen] = React.useState(false)
  const [crossRoleMenuOpen, setCrossRoleMenuOpen] = React.useState(false)
  const [crossRoleChoice, setCrossRoleChoice] = React.useState('MASTER')
  const selectorPendingRef = React.useRef(false)
  const [selectorAction, setSelectorAction] = React.useState(null)
  const crossRoleTextRef = React.useRef(null)
  const [activationAction, setActivationAction] = React.useState(null)
  const activationPendingRef = React.useRef(false)
  const [siteAccessPending, setSiteAccessPending] = React.useState(false)
  const crossRole = panelState.activation?.role ?? crossRoleChoice

  React.useEffect(() => {
    chrome.runtime.sendMessage({ type: 'mode.get' }).then((response) => response?.ok && setMode(response.mode)).catch(() => {})
    const listener = (message) => { if (message?.type === 'mode.stateChanged') setMode(message.mode) }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  React.useEffect(() => { modeTextRef.current?.jumpTo(mode === 'CROSS' ? 1 : 0) }, [mode])
  React.useEffect(() => { crossRoleTextRef.current?.jumpTo(crossRole === 'SLAVE' ? 1 : 0) }, [crossRole])

  React.useEffect(() => {
    if (!modeMenuOpen && !crossRoleMenuOpen) return undefined
    const close = (event) => {
      if (!modeMenuRef.current?.contains(event.target)) setModeMenuOpen(false)
      if (!crossRoleMenuRef.current?.contains(event.target)) setCrossRoleMenuOpen(false)
    }
    const escape = (event) => { if (event.key === 'Escape') { setModeMenuOpen(false); setCrossRoleMenuOpen(false) } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [modeMenuOpen, crossRoleMenuOpen])

  async function selectMode(_index, nextMode) {
    if (selectorPendingRef.current) return
    selectorPendingRef.current = true
    setSelectorAction('mode')
    setModeMenuOpen(false)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'mode.set', mode: nextMode })
      if (response?.ok) setMode(response.mode)
      else showError(new Error(response?.error ?? 'TETHER mode could not be changed'))
    } finally {
      selectorPendingRef.current = false
      setSelectorAction(null)
    }
  }

  async function selectCrossRole(_index, nextRole) {
    if (selectorPendingRef.current) return
    selectorPendingRef.current = true
    setSelectorAction('role')
    setCrossRoleMenuOpen(false)
    try {
      if (panelState.activation?.state === 'active') {
        const response = await chrome.runtime.sendMessage({ type: 'browserSession.role.set', role: nextRole })
        if (!response?.ok) throw new Error(response?.error ?? 'CROSS role could not be changed')
        setPanelState(response.state)
      }
      setCrossRoleChoice(nextRole)
    } catch (error) {
      showError(error)
    } finally {
      selectorPendingRef.current = false
      setSelectorAction(null)
    }
  }

  React.useEffect(() => {
    if (!globalThis.chrome?.runtime) return undefined
    const port = chrome.runtime.connect({ name: SIDE_PANEL_PORT })
    const bind = (tabId) => {
      if (!Number.isInteger(tabId)) return
      resetPanelForTab()
      port.postMessage({ type: 'panel.bind', tabId })
    }
    const onActivated = ({ tabId }) => bind(tabId)
    const onPortMessage = (message) => {
      if (message?.type === 'panel.bound') refreshPanelState().catch((error) => setPanelState({ access: 'error', error: error.message }))
    }
    port.onMessage.addListener(onPortMessage)
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => bind(tab?.id))
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      port.onMessage.removeListener(onPortMessage)
      port.disconnect()
    }
  }, [refreshPanelState, resetPanelForTab, setPanelState])

  const operationStage = panelState.calibrationOperation?.stage
  const calibrationActive = ['starting', 'selecting_composer', 'selecting_send'].includes(operationStage)
  const injectionStage = panelState.injectionOperation?.stage
  const injectionActive = injectionStage === 'injecting'
  const responseOperation = panelState.responseCalibration?.operation
  const responseStage = responseOperation?.stage
  const responseCalibrationActive = ['starting', 'injecting_marker', 'waiting_for_marker', 'marker_captured', 'inferring_structure', 'manual_selection_required', 'manual_selecting_turn'].includes(responseStage)
  const extractionOperation = panelState.extractionOperation
  const extractionActive = extractionOperation?.stage === 'observing'

  function showError(error) {
    setPanelState((current) => ({ ...current, error: error.message }))
  }

  async function enableSite() {
    if (siteAccessPending) return
    setSiteAccessPending(true)
    try {
      await requestCalibrationAccess(panelState.site.origin)
      await refreshPanelState()
    } catch (error) {
      showError(error)
    } finally {
      setSiteAccessPending(false)
    }
  }

  async function startCalibration() {
    if (startPendingRef.current || calibrationActive || injectionActive || responseCalibrationActive) return
    const requestId = crypto.randomUUID()
    startPendingRef.current = true
    setStartPending(true)
    setPanelState((current) => ({
      ...current,
      error: null,
      calibrationOperation: { stage: 'starting', requestId, error: null },
    }))
    try {
      const response = await chrome.runtime.sendMessage({ type: 'calibration.start', requestId })
      if (!response?.ok) throw new Error(response?.error ?? 'Calibration could not start')
      setPanelState((current) => ({ ...current, calibrationOperation: response.state, error: null }))
    } catch (error) {
      setPanelState((current) => ({
        ...current,
        calibrationOperation: { stage: 'failed', error: error.message },
        error: error.message,
      }))
    } finally {
      startPendingRef.current = false
      setStartPending(false)
    }
  }

  async function cancelCalibration() {
    await chrome.runtime.sendMessage({
      type: 'calibration.cancel',
      requestId: panelState.calibrationOperation?.requestId,
    })
    await refreshPanelState()
  }

  async function changeActivation(type) {
    if (activationPendingRef.current) return
    activationPendingRef.current = true
    const nextAction = type === 'browserSession.activate' ? 'activating' : 'deactivating'
    setActivationAction(nextAction)
    setPanelState((current) => ({ ...current, error: null }))
    try {
      const response = await chrome.runtime.sendMessage({
        type,
        role: type === 'browserSession.activate' && mode === 'CROSS' ? crossRoleChoice : undefined,
      })
      if (!response?.ok) throw new Error(response?.error ?? 'TETHER could not update this tab')
      setPanelState(response.state)
    } catch (error) {
      showError(error)
    } finally {
      activationPendingRef.current = false
      setActivationAction(null)
    }
  }

  async function submitTestMessage(event) {
    event.preventDefault()
    if (injectionPendingRef.current || injectionActive || !testMessage.trim()) return
    const requestId = crypto.randomUUID()
    injectionPendingRef.current = true
    setPanelState((current) => ({
      ...current,
      injectionOperation: { stage: 'injecting', requestId, error: null },
    }))
    try {
      const response = await chrome.runtime.sendMessage({ type: 'injection.start', requestId, text: testMessage })
      if (!response?.ok) throw new Error(response?.error ?? 'Test-message injection failed')
      setPanelState((current) => ({ ...current, injectionOperation: response.state }))
    } catch (error) {
      setPanelState((current) => ({
        ...current,
        injectionOperation: { stage: 'failed', error: error.message },
      }))
    } finally {
      injectionPendingRef.current = false
    }
  }

  async function cancelInjection() {
    await chrome.runtime.sendMessage({ type: 'injection.cancel' })
    await refreshPanelState()
  }

  async function startExtractionTest(event) {
    event.preventDefault()
    if (extractionActive || !testMessage.trim()) return
    const response = await chrome.runtime.sendMessage({ type: 'extraction.start', requestId: crypto.randomUUID(), text: testMessage })
    if (!response?.ok) showError(new Error(response?.error ?? 'Response extraction could not start'))
    await refreshPanelState().catch(() => {})
  }

  async function cancelExtractionTest() {
    await chrome.runtime.sendMessage({ type: 'extraction.cancel' })
    await refreshPanelState()
  }

  async function startResponseCalibration() {
    if (responseCalibrationPendingRef.current || responseCalibrationActive || injectionActive || calibrationActive) return
    const requestId = crypto.randomUUID()
    responseCalibrationPendingRef.current = true
    setPanelState((current) => ({
      ...current,
      error: null,
      responseCalibration: {
        ...current.responseCalibration,
        operation: { stage: 'starting', turn: 0, totalTurns: 3, error: null },
      },
    }))
    try {
      const response = await chrome.runtime.sendMessage({ type: 'responseCalibration.start', requestId })
      if (!response?.ok) throw new Error(response?.error ?? 'Response calibration could not start')
      await refreshPanelState()
    } catch (error) {
      showError(error)
      await refreshPanelState().catch(() => {})
    } finally {
      responseCalibrationPendingRef.current = false
    }
  }

  async function cancelResponseCalibration() {
    await chrome.runtime.sendMessage({ type: 'responseCalibration.cancel' })
    await refreshPanelState()
  }

  async function startManualResponseSelection() {
    const response = await chrome.runtime.sendMessage({ type: 'responseCalibration.manualSelect' })
    if (!response?.ok) showError(new Error(response?.error ?? 'Guided response selection could not start'))
    await refreshPanelState().catch(() => {})
  }

  function responseCalibrationContent() {
    if (responseCalibrationActive) {
      if (responseStage === 'manual_selection_required') {
        return (
          <div className="response-calibration-status response-calibration-status--error" role="status">
            <h3>Automatic learning needs one hint</h3>
            <p>The three responses are already captured. Select the complete latest assistant response card; TETHER will map the other two without sending more messages.</p>
            <button type="button" className="calibration-button" onClick={startManualResponseSelection}>Guide TETHER manually</button>
            <button type="button" className="text-button" onClick={cancelResponseCalibration}>Cancel response calibration</button>
          </div>
        )
      }
      if (responseStage === 'manual_selecting_turn') {
        return (
          <div className="response-calibration-status" role="status">
            <h3>Select the latest assistant response</h3>
            <p>On the page, click its complete response card. Use ↑ to widen the boundary, then press Enter.</p>
            <button type="button" className="text-button" onClick={cancelResponseCalibration}>Cancel response calibration</button>
          </div>
        )
      }
      const turn = Math.max(1, responseOperation?.turn ?? 1)
      const waiting = responseStage === 'waiting_for_marker'
      return (
        <div className="response-calibration-status" role="status">
          <div className="response-calibration-status__heading">
            <h3>Learning response structure</h3>
            <span>{turn}/3</span>
          </div>
          <p>{waiting ? 'Waiting for the browser model’s exact calibration marker.' : 'Sending and validating a controlled calibration turn.'}</p>
          <button type="button" className="text-button" onClick={cancelResponseCalibration}>Cancel response calibration</button>
        </div>
      )
    }
    if (panelState.responseCalibration?.state === 'ready') {
      return (
        <div className="response-calibration-status">
          <h3>Response calibration ready</h3>
          <p>Conversation, assistant-turn, and assistant-content structures are validated.</p>
          <button type="button" className="text-button" onClick={startResponseCalibration}>Calibrate again</button>
        </div>
      )
    }
    if (responseStage === 'failed') {
      return (
        <div className="response-calibration-status response-calibration-status--error" role="alert">
          <h3>Response calibration needs attention</h3>
          <p>{responseOperation?.error ?? 'The three response structures could not be validated.'}</p>
          <button type="button" className="calibration-button" onClick={startResponseCalibration}>Try three-message calibration again</button>
        </div>
      )
    }
    if (responseStage === 'cancelled') {
      return (
        <div className="response-calibration-status">
          <h3>Response calibration cancelled</h3>
          <p>No response fingerprints were replaced.</p>
          <button type="button" className="calibration-button" onClick={startResponseCalibration}>Start again</button>
        </div>
      )
    }
    return (
      <div className="response-calibration-status">
        <h3>Calibrate browser responses</h3>
        <p>TETHER will send three controlled marker messages to learn this site’s response structure.</p>
        <button type="button" className="calibration-button" onClick={startResponseCalibration}>Start three-message calibration</button>
      </div>
    )
  }

  function injectionContent() {
    if (panelState.responseCalibration?.state === 'ready') {
      return (
        <form className="injection-test" onSubmit={startExtractionTest}>
          <div className="injection-test__heading"><h3>Response extraction test</h3><span>Development</span></div>
          <label htmlFor="tether-test-message">Plain-text test prompt</label>
          <textarea id="tether-test-message" value={testMessage} onChange={(event) => setTestMessage(event.target.value)} maxLength={4096} rows={2} placeholder="Ask for a short harmless response" />
          {extractionActive && <div className="injection-status" role="status"><strong>Observing streamed response…</strong><span>The result will appear after the assistant text becomes stable.</span><button type="button" className="text-button" onClick={cancelExtractionTest}>Cancel test</button></div>}
          {extractionOperation?.stage === 'complete' && <div className="injection-feedback injection-feedback--success" role="status"><strong>Extracted response</strong><pre>{extractionOperation.result?.text}</pre></div>}
          {extractionOperation?.stage === 'failed' && <p className="injection-feedback injection-feedback--error" role="alert">{extractionOperation.error}</p>}
          <button type="submit" className="calibration-button" disabled={extractionActive || !testMessage.trim()}>Inject, observe, and extract</button>
        </form>
      )
    }
    if (injectionActive) {
      return (
        <div className="injection-status" role="status">
          <strong>Submitting test message…</strong>
          <span>TETHER is writing to the calibrated composer and verifying submission.</span>
          <button type="button" className="text-button" onClick={cancelInjection}>Cancel test</button>
        </div>
      )
    }
    return (
      <form className="injection-test" onSubmit={submitTestMessage}>
        <div className="injection-test__heading">
          <h3>Injection test</h3>
          <span>Development</span>
        </div>
        <label htmlFor="tether-test-message">Plain-text test message</label>
        <textarea
          id="tether-test-message"
          value={testMessage}
          onChange={(event) => setTestMessage(event.target.value)}
          maxLength={4096}
          rows={2}
          placeholder="Enter a harmless test message"
        />
        {injectionStage === 'complete' && <p className="injection-feedback injection-feedback--success" role="status">Test message submitted.</p>}
        {injectionStage === 'failed' && <p className="injection-feedback injection-feedback--error" role="alert">{panelState.injectionOperation?.error}</p>}
        {injectionStage === 'cancelled' && <p className="injection-feedback" role="status">Test cancelled.</p>}
        <button type="submit" className="calibration-button" disabled={!testMessage.trim()}>
          Inject and submit
        </button>
      </form>
    )
  }

  function calibrationContent() {
    if (calibrationActive) {
      return (
        <>
          <h3>Calibration in progress</h3>
          <p>{panelState.error ?? CALIBRATION_PROGRESS[operationStage]}</p>
          <button type="button" className="calibration-button calibration-button--secondary" onClick={cancelCalibration}>
            Cancel calibration
          </button>
        </>
      )
    }

    const state = panelState.calibration?.state
    const copy = projectCalibrationStatus(state)
    if (state === 'valid') {
      return (
        <>
          <h3>{copy.heading}</h3>
          <p>{copy.body}</p>
          <div className="button-stack">
            <button type="button" className="calibration-button calibration-button--secondary" onClick={startCalibration} disabled={startPending || injectionActive}>
              {copy.action}
            </button>
            <button type="button" className="text-button" onClick={refreshPanelState}>
              Validate calibration
            </button>
          </div>
        </>
      )
    }
    if (state === 'missing') {
      return (
        <>
          <h3>{copy.heading}</h3>
          <p>{copy.body}</p>
          <button type="button" className="calibration-button" onClick={startCalibration} disabled={startPending}>{copy.action}</button>
        </>
      )
    }
    if (state === 'validation_failed') {
      return (
        <>
          <h3>{copy.heading}</h3>
          <p>{copy.body}</p>
          <div className="button-stack">
            <button type="button" className="calibration-button" onClick={startCalibration} disabled={startPending}>{copy.action}</button>
            <button type="button" className="text-button" onClick={refreshPanelState}>Try validation again</button>
          </div>
        </>
      )
    }
    return (
      <>
        <h3>{copy.heading}</h3>
        <p>{copy.body}</p>
        <button type="button" className="calibration-button" onClick={startCalibration} disabled={startPending}>{copy.action}</button>
      </>
    )
  }

  function diagnostics() {
    const data = panelState.calibration?.diagnostics
    if (!data) return null
    return (
      <details className="diagnostics">
        <summary>Developer diagnostics</summary>
        <dl>
          <div><dt>Origin</dt><dd>{data.origin}</dd></div>
          <div><dt>Storage key</dt><dd>{data.storageKey}</dd></div>
          <div><dt>Loaded</dt><dd>{data.loaded ? 'Yes' : 'No'}</dd></div>
          <div><dt>Migrated</dt><dd>{data.migrated ? 'Yes' : 'No'}</dd></div>
          <div><dt>Profile source</dt><dd>{data.profileSource}</dd></div>
          <div><dt>Profile version</dt><dd>{data.profileVersion ?? 'None'}</dd></div>
          <div><dt>Created</dt><dd>{data.createdAt ? new Date(data.createdAt).toLocaleString() : 'Not recorded'}</dd></div>
          <div><dt>Composer fingerprint</dt><dd>{data.composerFingerprintExists ? 'Present' : 'Missing'}</dd></div>
          <div><dt>Send fingerprint</dt><dd>{data.sendFingerprintExists ? 'Present' : 'Missing'}</dd></div>
          <div><dt>Validation</dt><dd>{data.validationResult}</dd></div>
          <div><dt>Composer resolved</dt><dd>{data.composerResolved ? 'Yes' : 'No'}</dd></div>
          <div><dt>Send resolved</dt><dd>{data.sendResolved ? 'Yes' : 'No'}</dd></div>
          <div><dt>Last validation</dt><dd>{data.lastValidatedAt ? new Date(data.lastValidatedAt).toLocaleString() : 'Not validated'}</dd></div>
        </dl>
      </details>
    )
  }

  function panelContent() {
    if (panelState.access === 'loading') return <p className="calibration-copy" role="status">Reading this tab…</p>
    if (panelState.access === 'error') return <><h2>TETHER unavailable</h2><p role="alert">{panelState.error}</p></>
    if (panelState.access === 'restricted') {
      const copy = projectPrimaryStatus(panelState)
      return <><h2>{copy.heading}</h2><p>{copy.body}</p></>
    }
    if (panelState.access === 'required') {
      const copy = projectPrimaryStatus(panelState)
      const calibrationCopy = projectCalibrationStatus('access_required')
      return (
        <>
          <p className="site-label">{panelState.site.label}</p>
          <h2>{copy.heading}</h2>
          <p>{panelState.error ?? copy.body}</p>
          <button type="button" className="calibration-button" onClick={enableSite}>{copy.action}</button>
          <div className="calibration-section">
            <h3>{calibrationCopy.heading}</h3>
            <p>{calibrationCopy.body}</p>
          </div>
          {diagnostics()}
        </>
      )
    }

    const isActive = panelState.activation?.state === 'active'
    const calibrationValid = panelState.calibration?.state === 'valid'
    const copy = projectPrimaryStatus(panelState)
    if (calibrationActive || startPending) {
      return (
        <>
          <p className="site-label">{panelState.site.label}</p>
          <div className="calibration-section calibration-section--active">{calibrationContent()}</div>
        </>
      )
    }
    return (
      <>
        <p className="site-label">{panelState.site.label}</p>
        <h2>{copy.heading}</h2>
        <p>{panelState.error ?? copy.body}</p>
        {(isActive || calibrationValid) && (
          <button
            type="button"
            className="calibration-button"
            onClick={() => changeActivation(isActive ? 'browserSession.deactivate' : 'browserSession.activate')}
          >
            {copy.action}
          </button>
        )}
        <div className="calibration-section">{calibrationContent()}</div>
        {isActive && calibrationValid && <div className="response-calibration-section">{responseCalibrationContent()}</div>}
        {isActive && calibrationValid && !responseCalibrationActive && <div className="injection-section">{injectionContent()}</div>}
        {diagnostics()}
      </>
    )
  }

  // Preserve the existing calibration renderer for workflows that still call
  // its handlers, while keeping it out of this streamlined session surface.
  void panelContent

  return (
    <main className="tether-panel" aria-label="TETHER side panel">
      <div className="tether-fluid-layer">
        <Silk speed={5} scale={1} color="#5227FF" noiseIntensity={1.5} rotation={0} />
      </div>
      <section className="tether-title-stage" aria-label="TETHER mode selection">
        <div className="tether-title-lockup" data-mode={mode.toLowerCase()}>
          <span className="tether-wordmark">TETHER</span>
          <div className="mode-selector" ref={modeMenuRef}>
            <button type="button" className="mode-selector__trigger" aria-haspopup="listbox" aria-expanded={modeMenuOpen} title="Switch TETHER mode" disabled={Boolean(selectorAction || activationAction)} onClick={() => setModeMenuOpen((open) => !open)}>
              <RotatingText ref={modeTextRef} texts={['CLI', 'CROSS']} auto={false} staggerFrom="last" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '-120%' }} staggerDuration={.025} transition={{ type: 'spring', damping: 30, stiffness: 400 }} splitBy="characters" animatePresenceMode="sync" mainClassName="tether-mode-text" splitLevelClassName="tether-mode-clip" />
            </button>
            {modeMenuOpen && <div className="mode-selector__popover"><OptionWheel items={['CLI', 'CROSS']} defaultSelected={mode === 'CROSS' ? 1 : 0} onChange={selectMode} /></div>}
          </div>
          {mode === 'CROSS' && <div className="cross-role-menu" ref={crossRoleMenuRef}><button type="button" className="cross-role-selector" aria-haspopup="listbox" aria-expanded={crossRoleMenuOpen} aria-label={`Choose CROSS role. Currently ${crossRole}`} title="Choose whether this tab is MASTER or SLAVE" disabled={Boolean(selectorAction || activationAction)} onClick={() => setCrossRoleMenuOpen((open) => !open)}><RotatingText ref={crossRoleTextRef} texts={['MASTER', 'SLAVE']} auto={false} staggerFrom="last" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '-120%' }} staggerDuration={.018} transition={{ type: 'spring', damping: 30, stiffness: 400 }} animatePresenceMode="sync" mainClassName="cross-role-text" splitLevelClassName="tether-mode-clip" /></button>{crossRoleMenuOpen && <div className="cross-role-menu__popover"><OptionWheel items={['MASTER', 'SLAVE']} defaultSelected={crossRole === 'SLAVE' ? 1 : 0} onChange={selectCrossRole} /></div>}</div>}
        </div>
      </section>
      <section className="tether-session-console" aria-live="polite">
        <div className="session-console__eyebrow"><span>{mode === 'CROSS' ? `CROSS · ${panelState.endpoints?.count ?? 0}/2 endpoints` : 'CLI endpoint'}</span><span>{connectionState === 'connected' ? 'Local bridge online' : 'Local bridge offline'}</span></div>
        <h2>{panelState.activation?.state === 'active' ? 'TETHER is active on this tab' : (panelState.site?.hasAdapter || panelState.calibration?.state === 'valid') ? `${panelState.site?.label ?? 'This chat'} is ready` : 'This tab needs setup'}</h2>
        <p>{panelState.activation?.state === 'active' ? `${panelState.site?.label ?? 'Browser chat'} is registered for ${mode} requests.` : mode === 'CLI' ? 'Activate this tab as the fixed browser endpoint for Codex CLI prompts and responses.' : `Choose this tab as ${crossRole}, then activate it. Configure the other CROSS tab with the opposite role.`}</p>
        <dl className="session-console__facts"><div><dt>Mode</dt><dd>{mode === 'CROSS' ? `${mode} · ${crossRole}` : mode}</dd></div><div><dt>Current tab</dt><dd>{panelState.site?.label ?? 'Unsupported'}</dd></div><div><dt>TETHER</dt><dd>{panelState.activation?.state === 'active' ? 'Active' : (panelState.site?.hasAdapter || panelState.calibration?.state === 'valid') ? 'Ready' : 'Needs setup'}</dd></div></dl>
        <div className="session-console__features" aria-label={panelState.activation?.state === 'active' ? 'Activated features' : 'Available features'}>{(mode === 'CLI' ? ['Pinned routing', 'Background delivery', 'Tool bridge'] : ['Two-tab relay', `${crossRole} identity`, 'Loop protection']).map((feature) => <span key={feature}>{feature}</span>)}</div>
        {panelState.error && <p className="activation-feedback activation-feedback--error" role="alert">{panelState.error}</p>}
        {panelState.access === 'required' ? <button type="button" className="tether-activation-button" aria-busy={siteAccessPending} disabled={siteAccessPending} onClick={enableSite}><span className="activation-button__label">{siteAccessPending ? 'Waiting for permission…' : `Allow TETHER on ${panelState.site?.label ?? 'this site'}`}</span><span className="activation-button__state" aria-hidden="true">Permission</span></button> : panelState.access === 'granted' && !panelState.site?.hasAdapter && panelState.calibration?.state !== 'valid' ? <button type="button" className="tether-activation-button" aria-busy={startPending || calibrationActive} disabled={startPending || calibrationActive} onClick={startCalibration}><span className="activation-button__label">{startPending || calibrationActive ? 'Select the requested controls on the page…' : 'Calibrate this tab'}</span><span className="activation-button__state" aria-hidden="true">{calibrationActive ? 'In progress' : 'Required'}</span></button> : panelState.access === 'granted' && (panelState.site?.hasAdapter || panelState.calibration?.state === 'valid') ? <button type="button" className="tether-activation-button" aria-busy={Boolean(activationAction)} disabled={Boolean(activationAction) || (panelState.activation?.state !== 'active' && connectionState !== 'connected')} onClick={() => changeActivation(panelState.activation?.state === 'active' ? 'browserSession.deactivate' : 'browserSession.activate')}><span className="activation-button__label">{activationAction === 'activating' ? 'Activating this tab…' : activationAction === 'deactivating' ? 'Releasing this tab…' : panelState.activation?.state === 'active' ? 'Deactivate TETHER' : connectionState !== 'connected' ? 'Start TETHER CLI to activate' : `Activate as ${mode === 'CROSS' ? crossRole : 'CLI endpoint'}`}</span><span className="activation-button__state" aria-hidden="true">{activationAction ? 'Working' : panelState.activation?.state === 'active' ? 'Active' : connectionState === 'connected' ? 'Ready' : 'Bridge offline'}</span></button> : <p className="session-console__hint">Open a supported AI chat or calibrate this site to activate an endpoint.</p>}
      </section>
    </main>
  )
}

export default App
