import './App.css'
import React from 'react'
import TetherProductUI from './components/TetherProductUI'
import { requestCalibrationAccess } from './calibration/calibration-access.js'
import { SIDE_PANEL_PORT } from './calibration/panel-lifecycle.js'
import { shouldBindPanelToActivation } from './panel-binding-policy.js'
import { projectCalibrationStatus, projectPrimaryStatus } from './panel-state-model.js'

const CALIBRATION_PROGRESS = {
  starting: 'Preparing the calibration inspector…',
  selecting_composer: 'On the page, select the message box where you type.',
  selecting_send: 'Composer saved. Now select the Send control.',
}

const DEMO_PANEL_STATE = {
  access: 'granted',
  site: {
    label: 'ChatGPT',
    origin: 'https://chatgpt.com',
    host: 'chatgpt.com',
    hasAdapter: true,
  },
  activation: { state: 'inactive', role: null },
  calibration: { state: 'valid', validation: { valid: true }, diagnostics: null },
  endpoints: { count: 0 },
  responseCalibration: { state: 'idle', operation: null },
  injectionOperation: null,
  extractionOperation: null,
  error: null,
}

function useConnectionState() {
  const [state, setState] = React.useState(() => globalThis.chrome?.runtime ? 'unavailable' : 'connected')
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
  const [state, setState] = React.useState(() => globalThis.chrome?.runtime ? { access: 'loading' } : DEMO_PANEL_STATE)
  const stateRef = React.useRef(state)
  const requestSequence = React.useRef(0)
  React.useEffect(() => { stateRef.current = state }, [state])
  const refresh = React.useCallback(async () => {
    if (!globalThis.chrome?.runtime) return stateRef.current
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
  const extractionPendingRef = React.useRef(false)
  const manualSelectionPendingRef = React.useRef(false)
  const cancellationPendingRef = React.useRef(false)
  const responseCalibrationPendingRef = React.useRef(false)
  const [mode, setMode] = React.useState('CLI')
  const [crossRoleChoice, setCrossRoleChoice] = React.useState('MASTER')
  const selectorPendingRef = React.useRef(false)
  const [selectorAction, setSelectorAction] = React.useState(null)
  const [activationAction, setActivationAction] = React.useState(null)
  const activationPendingRef = React.useRef(false)
  const [siteAccessPending, setSiteAccessPending] = React.useState(false)
  const siteAccessPendingRef = React.useRef(false)
  const siteAccessSequenceRef = React.useRef(0)
  const calibrationSequenceRef = React.useRef(0)
  const bindingRef = React.useRef({ tabId: null, version: 0 })
  const connectionMomentSequence = React.useRef(0)
  const [connectionMoment, setConnectionMoment] = React.useState(null)
  const crossRole = panelState.activation?.role ?? crossRoleChoice

  const captureBinding = React.useCallback(() => ({ ...bindingRef.current }), [])
  const isCurrentBinding = React.useCallback((ticket) => (
    ticket.version === bindingRef.current.version && ticket.tabId === bindingRef.current.tabId
  ), [])

  React.useEffect(() => {
    if (!globalThis.chrome?.runtime) return undefined
    chrome.runtime.sendMessage({ type: 'mode.get' }).then((response) => response?.ok && setMode(response.mode)).catch(() => {})
    const listener = (message) => { if (message?.type === 'mode.stateChanged') setMode(message.mode) }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  async function selectMode(value, legacyValue) {
    const nextMode = legacyValue ?? value
    if (selectorPendingRef.current) return
    selectorPendingRef.current = true
    setSelectorAction('mode')
    try {
      if (!globalThis.chrome?.runtime) {
        await new Promise((resolve) => setTimeout(resolve, 180))
        setMode(nextMode)
        return
      }
      const response = await chrome.runtime.sendMessage({ type: 'mode.set', mode: nextMode })
      if (response?.ok) setMode(response.mode)
      else showError(new Error(response?.error ?? 'TETHER mode could not be changed'))
    } finally {
      selectorPendingRef.current = false
      setSelectorAction(null)
    }
  }

  async function selectCrossRole(value, legacyValue) {
    const nextRole = legacyValue ?? value
    if (selectorPendingRef.current) return
    const binding = captureBinding()
    selectorPendingRef.current = true
    setSelectorAction('role')
    try {
      if (panelState.activation?.state === 'active') {
        if (!globalThis.chrome?.runtime) {
          setCrossRoleChoice(nextRole)
          return
        }
        const response = await chrome.runtime.sendMessage({ type: 'browserSession.role.set', role: nextRole })
        if (!response?.ok) throw new Error(response?.error ?? 'CROSS role could not be changed')
        if (isCurrentBinding(binding)) setPanelState(response.state)
      }
      if (isCurrentBinding(binding)) setCrossRoleChoice(nextRole)
    } catch (error) {
      showError(error, binding)
    } finally {
      selectorPendingRef.current = false
      setSelectorAction(null)
    }
  }

  React.useEffect(() => {
    if (!globalThis.chrome?.runtime) return undefined
    const port = chrome.runtime.connect({ name: SIDE_PANEL_PORT })
    const panelWindowIdRef = { current: null }
    const bind = (tabId) => {
      if (!Number.isInteger(tabId)) return
      bindingRef.current = { tabId, version: bindingRef.current.version + 1 }
      connectionMomentSequence.current += 1
      siteAccessSequenceRef.current += 1
      calibrationSequenceRef.current += 1
      activationPendingRef.current = false
      siteAccessPendingRef.current = false
      startPendingRef.current = false
      injectionPendingRef.current = false
      extractionPendingRef.current = false
      responseCalibrationPendingRef.current = false
      manualSelectionPendingRef.current = false
      cancellationPendingRef.current = false
      setConnectionMoment(null)
      setActivationAction(null)
      setSiteAccessPending(false)
      setStartPending(false)
      resetPanelForTab()
      port.postMessage({ type: 'panel.bind', tabId })
    }
    const onActivated = (activeInfo) => {
      if (shouldBindPanelToActivation(panelWindowIdRef.current, activeInfo)) bind(activeInfo.tabId)
    }
    const onPortMessage = (message) => {
      if (message?.type === 'panel.bound' && message.tabId === bindingRef.current.tabId) {
        const binding = captureBinding()
        refreshPanelState().catch((error) => {
          if (isCurrentBinding(binding)) setPanelState({ access: 'error', error: error.message })
        })
      }
    }
    port.onMessage.addListener(onPortMessage)
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (Number.isInteger(tab?.windowId)) panelWindowIdRef.current = tab.windowId
      bind(tab?.id)
    })
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      port.onMessage.removeListener(onPortMessage)
      port.disconnect()
    }
  }, [captureBinding, isCurrentBinding, refreshPanelState, resetPanelForTab, setPanelState])

  const operationStage = panelState.calibrationOperation?.stage
  const calibrationActive = ['starting', 'selecting_composer', 'selecting_send'].includes(operationStage)
  const injectionStage = panelState.injectionOperation?.stage
  const injectionActive = injectionStage === 'injecting'
  const responseOperation = panelState.responseCalibration?.operation
  const responseStage = responseOperation?.stage
  const responseCalibrationActive = ['starting', 'injecting_marker', 'waiting_for_marker', 'marker_captured', 'inferring_structure', 'manual_selection_required', 'manual_selecting_turn'].includes(responseStage)
  const extractionOperation = panelState.extractionOperation
  const extractionActive = extractionOperation?.stage === 'observing'

  function showError(error, binding = captureBinding()) {
    if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, error: error.message }))
  }

  async function enableSite() {
    if (siteAccessPendingRef.current) return
    const binding = captureBinding()
    const operationId = ++siteAccessSequenceRef.current
    siteAccessPendingRef.current = true
    setSiteAccessPending(true)
    try {
      if (!globalThis.chrome?.runtime) {
        await new Promise((resolve) => setTimeout(resolve, 420))
        if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, access: 'granted', error: null }))
        return
      }
      await requestCalibrationAccess(panelState.site.origin)
      if (isCurrentBinding(binding)) await refreshPanelState()
    } catch (error) {
      showError(error, binding)
    } finally {
      if (operationId === siteAccessSequenceRef.current) {
        siteAccessPendingRef.current = false
        if (isCurrentBinding(binding)) setSiteAccessPending(false)
      }
    }
  }

  async function startCalibration() {
    if (startPendingRef.current || calibrationActive || injectionActive || responseCalibrationActive) return
    const binding = captureBinding()
    const operationId = ++calibrationSequenceRef.current
    const requestId = crypto.randomUUID()
    startPendingRef.current = true
    setStartPending(true)
    setPanelState((current) => ({
      ...current,
      error: null,
      calibrationOperation: { stage: 'starting', requestId, error: null },
    }))
    try {
      if (!globalThis.chrome?.runtime) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, calibration: { ...current.calibration, state: 'valid' }, calibrationOperation: null, error: null }))
        return
      }
      const response = await chrome.runtime.sendMessage({ type: 'calibration.start', requestId })
      if (!response?.ok) throw new Error(response?.error ?? 'Calibration could not start')
      if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, calibrationOperation: response.state, error: null }))
    } catch (error) {
      if (isCurrentBinding(binding)) setPanelState((current) => ({
        ...current,
        calibrationOperation: { stage: 'failed', error: error.message },
        error: error.message,
      }))
    } finally {
      if (operationId === calibrationSequenceRef.current) {
        startPendingRef.current = false
        if (isCurrentBinding(binding)) setStartPending(false)
      }
    }
  }

  async function cancelCalibration() {
    if (cancellationPendingRef.current) return
    const binding = captureBinding()
    cancellationPendingRef.current = true
    try {
      if (!globalThis.chrome?.runtime) {
        setPanelState((current) => ({ ...current, calibrationOperation: null }))
        return
      }
      await chrome.runtime.sendMessage({
        type: 'calibration.cancel',
        requestId: panelState.calibrationOperation?.requestId,
      })
      if (isCurrentBinding(binding)) await refreshPanelState()
    } finally {
      cancellationPendingRef.current = false
    }
  }

  async function changeActivation(type) {
    if (activationPendingRef.current) return
    const binding = captureBinding()
    const momentId = ++connectionMomentSequence.current
    activationPendingRef.current = true
    const nextAction = type === 'browserSession.activate' ? 'activating' : 'deactivating'
    const startedAt = performance.now()
    setActivationAction(nextAction)
    setConnectionMoment({ id: momentId, kind: nextAction, stage: 'working', host: panelState.site?.host ?? panelState.site?.label })
    setPanelState((current) => ({ ...current, error: null }))
    try {
      let nextState
      if (!globalThis.chrome?.runtime) {
        await new Promise((resolve) => setTimeout(resolve, 360))
        const activating = type === 'browserSession.activate'
        nextState = {
          ...panelState,
          activation: { state: activating ? 'active' : 'inactive', role: activating && mode === 'CROSS' ? crossRoleChoice : null },
          endpoints: { count: activating ? 1 : 0 },
        }
      } else {
        const response = await chrome.runtime.sendMessage({
          type,
          role: type === 'browserSession.activate' && mode === 'CROSS' ? crossRoleChoice : undefined,
        })
        if (!response?.ok) throw new Error(response?.error ?? 'TETHER could not update this tab')
        nextState = response.state
      }
      if (!isCurrentBinding(binding) || momentId !== connectionMomentSequence.current) return
      setPanelState(nextState)
      const remaining = Math.max(0, 560 - (performance.now() - startedAt))
      if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining))
      if (!isCurrentBinding(binding) || momentId !== connectionMomentSequence.current) return
      setConnectionMoment((current) => current?.id === momentId ? { ...current, stage: 'complete' } : current)
      await new Promise((resolve) => setTimeout(resolve, 720))
    } catch (error) {
      if (isCurrentBinding(binding) && momentId === connectionMomentSequence.current) {
        showError(error, binding)
        setConnectionMoment((current) => current?.id === momentId ? { ...current, stage: 'failed' } : current)
        await new Promise((resolve) => setTimeout(resolve, 900))
      }
    } finally {
      if (momentId === connectionMomentSequence.current) activationPendingRef.current = false
      if (isCurrentBinding(binding) && momentId === connectionMomentSequence.current) {
        setConnectionMoment(null)
        setActivationAction(null)
      }
    }
  }

  async function submitTestMessage(event) {
    event.preventDefault()
    if (injectionPendingRef.current || injectionActive || !testMessage.trim()) return
    const binding = captureBinding()
    const requestId = crypto.randomUUID()
    injectionPendingRef.current = true
    setPanelState((current) => ({
      ...current,
      injectionOperation: { stage: 'injecting', requestId, error: null },
    }))
    try {
      if (!globalThis.chrome?.runtime) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, injectionOperation: { stage: 'complete', requestId } }))
        return
      }
      const response = await chrome.runtime.sendMessage({ type: 'injection.start', requestId, text: testMessage })
      if (!response?.ok) throw new Error(response?.error ?? 'Test-message injection failed')
      if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, injectionOperation: response.state }))
    } catch (error) {
      if (isCurrentBinding(binding)) setPanelState((current) => ({
        ...current,
        injectionOperation: { stage: 'failed', error: error.message },
      }))
    } finally {
      injectionPendingRef.current = false
    }
  }

  async function cancelInjection() {
    if (cancellationPendingRef.current) return
    const binding = captureBinding()
    cancellationPendingRef.current = true
    try {
      if (!globalThis.chrome?.runtime) {
        setPanelState((current) => ({ ...current, injectionOperation: { stage: 'cancelled' } }))
        return
      }
      await chrome.runtime.sendMessage({ type: 'injection.cancel' })
      if (isCurrentBinding(binding)) await refreshPanelState()
    } finally {
      cancellationPendingRef.current = false
    }
  }

  async function startExtractionTest(event) {
    event.preventDefault()
    if (extractionPendingRef.current || extractionActive || !testMessage.trim()) return
    const binding = captureBinding()
    extractionPendingRef.current = true
    try {
      if (!globalThis.chrome?.runtime) {
        setPanelState((current) => ({ ...current, extractionOperation: { stage: 'observing' } }))
        await new Promise((resolve) => setTimeout(resolve, 650))
        if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, extractionOperation: { stage: 'complete', result: { text: 'Preview response extracted successfully.' } } }))
        return
      }
      const response = await chrome.runtime.sendMessage({ type: 'extraction.start', requestId: crypto.randomUUID(), text: testMessage })
      if (!response?.ok) showError(new Error(response?.error ?? 'Response extraction could not start'), binding)
      if (isCurrentBinding(binding)) await refreshPanelState().catch(() => {})
    } finally {
      extractionPendingRef.current = false
    }
  }

  async function cancelExtractionTest() {
    if (cancellationPendingRef.current) return
    const binding = captureBinding()
    cancellationPendingRef.current = true
    try {
      if (!globalThis.chrome?.runtime) {
        setPanelState((current) => ({ ...current, extractionOperation: { stage: 'cancelled' } }))
        return
      }
      await chrome.runtime.sendMessage({ type: 'extraction.cancel' })
      if (isCurrentBinding(binding)) await refreshPanelState()
    } finally {
      cancellationPendingRef.current = false
    }
  }

  async function startResponseCalibration() {
    if (responseCalibrationPendingRef.current || responseCalibrationActive || injectionActive || calibrationActive) return
    const binding = captureBinding()
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
      if (!globalThis.chrome?.runtime) {
        await new Promise((resolve) => setTimeout(resolve, 720))
        if (isCurrentBinding(binding)) setPanelState((current) => ({ ...current, responseCalibration: { state: 'ready', operation: { stage: 'complete' } } }))
        return
      }
      const response = await chrome.runtime.sendMessage({ type: 'responseCalibration.start', requestId })
      if (!response?.ok) throw new Error(response?.error ?? 'Response calibration could not start')
      if (isCurrentBinding(binding)) await refreshPanelState()
    } catch (error) {
      showError(error, binding)
      if (isCurrentBinding(binding)) await refreshPanelState().catch(() => {})
    } finally {
      responseCalibrationPendingRef.current = false
    }
  }

  async function cancelResponseCalibration() {
    if (cancellationPendingRef.current) return
    const binding = captureBinding()
    cancellationPendingRef.current = true
    try {
      if (!globalThis.chrome?.runtime) {
        setPanelState((current) => ({ ...current, responseCalibration: { state: 'idle', operation: { stage: 'cancelled' } } }))
        return
      }
      await chrome.runtime.sendMessage({ type: 'responseCalibration.cancel' })
      if (isCurrentBinding(binding)) await refreshPanelState()
    } finally {
      cancellationPendingRef.current = false
    }
  }

  async function startManualResponseSelection() {
    if (manualSelectionPendingRef.current) return
    const binding = captureBinding()
    manualSelectionPendingRef.current = true
    try {
      if (!globalThis.chrome?.runtime) {
        setPanelState((current) => ({ ...current, responseCalibration: { ...current.responseCalibration, operation: { stage: 'manual_selecting_turn' } } }))
        return
      }
      const response = await chrome.runtime.sendMessage({ type: 'responseCalibration.manualSelect' })
      if (!response?.ok) showError(new Error(response?.error ?? 'Guided response selection could not start'), binding)
      if (isCurrentBinding(binding)) await refreshPanelState().catch(() => {})
    } finally {
      manualSelectionPendingRef.current = false
    }
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

  void panelContent

  const isActive = panelState.activation?.state === 'active'
  const advancedContent = (
    <div className="product-tools">
      {!calibrationActive && <section className="product-tool-card">{calibrationContent()}</section>}
      {isActive && panelState.calibration?.state === 'valid' && <section className="product-tool-card">{responseCalibrationContent()}</section>}
      {isActive && panelState.calibration?.state === 'valid' && !responseCalibrationActive && <section className="product-tool-card">{injectionContent()}</section>}
      {diagnostics()}
    </div>
  )

  return (
    <TetherProductUI
      state={panelState}
      connectionState={connectionState}
      mode={mode}
      role={crossRole}
      actionBusy={Boolean(activationAction)}
      actionKind={activationAction}
      selectorBusy={selectorAction}
      siteAccessPending={siteAccessPending}
      calibrationActive={calibrationActive}
      startPending={startPending}
      connectionMoment={connectionMoment}
      workflowContent={<div className="product-tools"><section className="product-tool-card">{calibrationContent()}</section></div>}
      advancedContent={advancedContent}
      onMode={selectMode}
      onRole={selectCrossRole}
      onEnableSite={enableSite}
      onCalibrate={startCalibration}
      onActivate={() => changeActivation('browserSession.activate')}
      onDeactivate={() => changeActivation('browserSession.deactivate')}
    />
  )
}

export default App
