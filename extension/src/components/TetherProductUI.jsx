import React from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

function Icon({ name, size = 18 }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
    moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" />,
    arrow: <><path d="M5 12h13M13 7l5 5-5 5" /></>,
    power: <><path d="M12 2v10" /><path d="M6.3 5.7a8 8 0 1 0 11.4 0" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    refresh: <><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function TetherMark({ inverted = false }) {
  return (
    <span className={`tether-mark${inverted ? ' tether-mark--inverted' : ''}`} aria-hidden="true">
      <span className="tether-mark__node" />
      <span className="tether-mark__line" />
      <span className="tether-mark__stem" />
      <span className="tether-mark__node tether-mark__node--accent" />
    </span>
  )
}

function SiteIcon({ site, className = '' }) {
  const [failedSource, setFailedSource] = React.useState(null)
  const source = site?.faviconUrl
  return (
    <span className={`site-icon-tile${className ? ` ${className}` : ''}`} aria-hidden="true">
      {source && failedSource !== source
        ? <img src={source} alt="" onError={() => setFailedSource(source)} />
        : <span>{site?.label?.trim().slice(0, 1).toUpperCase() || 'T'}</span>}
    </span>
  )
}

function Header({ active, theme, onTheme, onMenu, menuButtonRef }) {
  return (
    <header className={`product-header${active ? ' product-header--active' : ''}`}>
      <div className="product-brand" aria-label="TETHER">
        <TetherMark inverted={active && theme === 'dark'} />
        <span>TETHER</span>
      </div>
      <div className="header-actions">
        <button type="button" className="round-button" onClick={onTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button ref={menuButtonRef} type="button" className="round-button" onClick={onMenu} aria-label="Open TETHER menu">
          <Icon name="menu" />
        </button>
      </div>
    </header>
  )
}

function OpeningExperience({ visible }) {
  const reducedMotion = useReducedMotion()
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="opening-experience"
          role="status"
          aria-label="Opening TETHER"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.05 : 0.18 }}
        >
          <div className="opening-lockup">
            <TetherMark inverted />
            <strong>TETHER</strong>
          </div>
          <div className="opening-status"><span /> Binding current tab</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ConnectionMoment({ moment }) {
  const reducedMotion = useReducedMotion()
  if (!moment) return null
  const activating = moment.kind === 'activating'
  const complete = moment.stage === 'complete'
  const failed = moment.stage === 'failed'
  return (
    <motion.section
      className={`connection-moment connection-moment--${activating ? 'orange' : 'charcoal'}`}
      role={failed ? 'alert' : 'status'}
      aria-live="assertive"
      initial={reducedMotion ? { opacity: 0 } : { clipPath: 'circle(0% at 50% 76%)' }}
      animate={reducedMotion ? { opacity: 1 } : { clipPath: 'circle(150% at 50% 76%)' }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.08 : 0.58, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={`connection-orbit${complete ? ' is-complete' : ''}${failed ? ' is-failed' : ''}`}>
        <span className="connection-node connection-node--source"><TetherMark inverted={!activating} /></span>
        <span className="connection-line"><i /></span>
        <span className="connection-node connection-node--result">{failed ? <Icon name="close" size={28} /> : complete ? <Icon name={activating ? 'check' : 'power'} size={30} /> : <span className="connection-pulse" />}</span>
      </div>
      <p>{failed ? 'Connection interrupted' : complete ? (activating ? 'Endpoint secured' : 'Endpoint released') : (activating ? 'Securing endpoint' : 'Releasing endpoint')}</p>
      <h1>{failed ? 'TETHER needs attention.' : complete ? (activating ? 'TETHER is connected.' : 'TETHER is deactivated.') : (activating ? 'Making the connection.' : 'Handing the tab back.')}</h1>
      <span className="connection-host">{moment.host || 'Current browser tab'}</span>
    </motion.section>
  )
}

function ConnectionDiagram({ mode, role }) {
  return (
    <figure className="connection-diagram" aria-label={`${mode} route preview`}>
      <svg viewBox="0 0 360 148" role="img" aria-hidden="true">
        <path className="diagram-grid" d="M0 35H360M0 74H360M0 113H360M55 0V148M180 0V148M305 0V148" />
        <path className="diagram-route" d={mode === 'CROSS' ? 'M42 74 C95 10 137 138 184 74 S276 10 320 74' : 'M42 74 C118 10 239 138 320 74'} />
        <circle className="diagram-node" cx="42" cy="74" r="11" />
        {mode === 'CROSS' && <circle className="diagram-node diagram-node--middle" cx="184" cy="74" r="11" />}
        <circle className="diagram-node diagram-node--end" cx="320" cy="74" r="16" />
        <circle className="diagram-signal" cx="42" cy="74" r="4" />
      </svg>
      <figcaption><span>Local bridge</span><strong>{mode === 'CROSS' ? `${role} relay` : 'One continuous endpoint'}</strong></figcaption>
    </figure>
  )
}

function Segment({ label, value, options, disabled, onChange }) {
  return (
    <div className="control-group">
      <div className="control-label"><span>{label}</span>{disabled && <small>Locked while active</small>}</div>
      <div className="product-segment" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}>
            <strong>{option.label}</strong><small>{option.hint}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

function StatusFact({ label, value, tone }) {
  return <div className="status-fact"><span>{label}</span><strong className={tone ? `is-${tone}` : ''}>{value}</strong></div>
}

function SetupSurface(props) {
  const {
    state, connectionState, mode, role, actionBusy, selectorBusy, siteAccessPending,
    selectorRequestPending, calibrationActive, startPending, onMode, onRole, onEnableSite,
    onRequestSelectors, onCalibrate, onActivate,
    advancedOpen, onToggleAdvanced, advancedContent,
  } = props
  const site = state.site
  const isReady = state.access === 'granted' && (site?.hasAdapter || state.calibration?.state === 'valid')
  const isRestricted = state.access === 'restricted'
  const bridgeReady = connectionState === 'connected'
  let buttonLabel = bridgeReady ? `Activate as ${mode === 'CROSS' ? role : 'CLI endpoint'}` : 'Start TETHER CLI to activate'
  let buttonState = bridgeReady ? 'Ready' : 'Bridge offline'
  let buttonAction = onActivate
  let buttonDisabled = actionBusy || !bridgeReady
  let showCalibrationFallback = false

  if (state.access === 'loading') {
    buttonLabel = 'Reading this tab…'; buttonState = 'Checking'; buttonDisabled = true
  } else if (state.access === 'required') {
    buttonLabel = siteAccessPending ? 'Waiting for permission…' : `Allow TETHER on ${site?.label ?? 'this site'}`
    buttonState = 'Permission'; buttonAction = onEnableSite; buttonDisabled = siteAccessPending
  } else if (state.access === 'granted' && !isReady) {
    if (site?.selectorRequestEligible) {
      const requestStatus = selectorRequestPending ? 'submitting' : state.selectorRequest?.status
      if (requestStatus === 'pending' || requestStatus === 'submitting') {
        buttonLabel = requestStatus === 'submitting' ? 'Registering selector request…' : 'Selector request under consideration'
        buttonState = requestStatus === 'submitting' ? 'Sending' : 'Hang tight'
        buttonDisabled = true
      } else {
        buttonLabel = requestStatus === 'available' ? 'Retry published selectors' : 'Request selectors for this site'
        buttonState = requestStatus === 'available' ? 'Published' : 'Request'
        buttonAction = onRequestSelectors
        buttonDisabled = selectorRequestPending
      }
      showCalibrationFallback = !calibrationActive
    } else {
      buttonLabel = startPending || calibrationActive ? 'Select the requested controls on the page…' : 'Calibrate this tab'
      buttonState = calibrationActive ? 'In progress' : 'Required'
      buttonAction = onCalibrate
      buttonDisabled = startPending || calibrationActive
    }
  } else if (isRestricted || state.access === 'error') {
    buttonLabel = isRestricted ? 'Open a browser-based AI chat' : 'TETHER is unavailable'
    buttonState = 'Unavailable'; buttonDisabled = true
  }

  const readiness = isRestricted ? 'Unavailable' : isReady ? 'Ready' : state.access === 'loading' ? 'Checking' : 'Needs setup'
  return (
    <motion.main className="setup-surface" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section className="editorial-hero">
        <p className="hero-wordmark">TET<span>H</span>ER</p>
        <h1>Keep the thread.</h1>
        <p>Turn the browser chat already in front of you into a private, tab-bound endpoint for Codex.</p>
      </section>

      <section className="endpoint-card" id="endpoint-setup" aria-labelledby="endpoint-heading">
        <div className="endpoint-card__topline"><span>Current endpoint</span><span className={`bridge-pill${bridgeReady ? ' is-online' : ''}`}><i />{bridgeReady ? 'Bridge online' : 'Bridge offline'}</span></div>
        <div className="endpoint-identity"><SiteIcon site={site} /><div><h2 id="endpoint-heading">{site?.label ?? (state.access === 'loading' ? 'Reading current tab' : 'Unsupported page')}</h2><p>{site?.origin ?? 'Waiting for browser context'}</p></div><strong className={isReady ? 'is-ready' : ''}>{readiness}</strong></div>

        <Segment label="Transport" value={mode} disabled={Boolean(selectorBusy || actionBusy || state.endpoints?.count > 0)} onChange={onMode} options={[{ value: 'CLI', label: 'CLI', hint: 'One endpoint' }, { value: 'CROSS', label: 'CROSS', hint: 'Two-tab relay' }]} />
        {mode === 'CROSS' && <Segment label="Role for this endpoint" value={role} disabled={Boolean(selectorBusy || actionBusy)} onChange={onRole} options={[{ value: 'MASTER', label: 'MASTER', hint: 'Drives first' }, { value: 'SLAVE', label: 'SLAVE', hint: 'Receives relay' }]} />}

        {state.error && <p className="product-error" role="alert">{state.error}</p>}
        <button type="button" className="product-primary" disabled={buttonDisabled} aria-busy={actionBusy || siteAccessPending || selectorRequestPending || startPending} onClick={buttonAction}>
          <span>{buttonLabel}</span><span className="product-primary__state">{buttonState}<Icon name="arrow" /></span>
        </button>
        {showCalibrationFallback && (
          <button type="button" className="setup-fallback" onClick={onCalibrate} disabled={startPending || calibrationActive}>
            Need it now? Calibrate locally as a fallback
          </button>
        )}
        <div className="endpoint-facts">
          <StatusFact label="Current tab" value={site?.label ?? 'Unavailable'} />
          <StatusFact label="Site controls" value={site?.hasAdapter ? (site.adapterSource === 'remote' ? 'Registry adapter' : 'Built in') : state.selectorRequest?.status === 'pending' ? 'Requested' : state.calibration?.state === 'valid' ? 'Calibrated' : 'Setup required'} />
          <StatusFact label="Ownership" value="This tab only" />
        </div>
      </section>

      {(calibrationActive || startPending) && <section className="workflow-callout" role="status">{props.workflowContent}</section>}
      <ConnectionDiagram mode={mode} role={role} />

      <section className="advanced-section">
        <button type="button" className="advanced-toggle" aria-expanded={advancedOpen} onClick={onToggleAdvanced}><span>Setup & diagnostics</span><Icon name="chevron" /></button>
        <AnimatePresence initial={false}>{advancedOpen && <motion.div className="advanced-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{advancedContent}</motion.div>}</AnimatePresence>
      </section>
    </motion.main>
  )
}

function ActiveSurface({ state, connectionState, liveReady, mode, role, actionBusy, actionKind, onDeactivate, advancedOpen, onToggleAdvanced, advancedContent }) {
  const site = state.site
  const modeLabel = mode === 'CROSS' ? `${role} · CROSS` : 'CLI endpoint'
  const bridgeOnline = connectionState === 'connected'
  const activeLabel = bridgeOnline ? (liveReady ? 'Live endpoint' : 'Confirming endpoint') : 'Bridge reconnecting'
  return (
    <motion.main className="active-surface" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="active-scroll">
        <section className={`active-intro${liveReady ? ' is-live' : ''}${bridgeOnline ? '' : ' is-offline'}`}><p><i /> {activeLabel}</p><h1>{bridgeOnline ? <>Endpoint<br />is <em>live.</em></> : <>Endpoint<br />is reserved.</>}</h1><span>{bridgeOnline ? 'The page is protected while TETHER owns this route.' : 'The CLI is offline. This tab stays protected while TETHER attempts to reconnect.'}</span></section>
        <section className="source-block">
          <div className="source-block__top"><span className="source-provider"><SiteIcon site={site} className="site-icon-tile--source" /><span>{site?.label ?? 'Browser chat'}</span></span><strong>{modeLabel}</strong></div>
          <h2>{site?.host ?? site?.origin ?? 'Connected tab'}</h2>
          <div className="source-context"><span>{site?.title ?? 'Selected browser chat'}</span><span>Protected tab</span></div>
          <div className="source-line"><span /></div>
        </section>
        {!bridgeOnline && <section className="bridge-recovery" role="status"><span className="bridge-recovery__icon"><Icon name="refresh" /></span><div><strong>Local CLI connection lost</strong><p>Restart TETHER CLI to resume this reserved endpoint, or release the tab safely now.</p></div><button type="button" onClick={onDeactivate} disabled={actionBusy}>Deactivate safely</button></section>}
        <section className="activity-section">
          <div className="activity-heading"><span>Connection</span><span>03</span></div>
          <div className="activity-row"><span>01</span><div><strong>Tab bound</strong><p>Session identity belongs to this browser tab only.</p></div></div>
          <div className="activity-row"><span>02</span><div><strong>Interaction guard active</strong><p>Accidental page input is blocked until deactivation.</p></div></div>
          <div className="activity-row"><span>03</span><div><strong>{bridgeOnline ? (liveReady ? 'Bridge routable' : 'Verifying route') : 'Bridge reconnecting'}</strong><p>{bridgeOnline ? (liveReady ? 'Ready for correlated Codex requests.' : 'Confirming the restored route for this tab.') : 'The session is preserved so a short CLI restart does not destroy tab context.'}</p></div></div>
        </section>
        <section className="advanced-section advanced-section--active">
          <button type="button" className="advanced-toggle" aria-expanded={advancedOpen} onClick={onToggleAdvanced}><span>Endpoint tools & diagnostics</span><Icon name="chevron" /></button>
          <AnimatePresence initial={false}>{advancedOpen && <motion.div className="advanced-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{advancedContent}</motion.div>}</AnimatePresence>
        </section>
      </div>
      <div className="release-dock"><div><span>{modeLabel}</span><strong>{actionKind === 'deactivating' ? 'Releasing endpoint…' : 'TETHER is active'}</strong></div><button type="button" disabled={actionBusy} aria-busy={actionBusy} onClick={onDeactivate} aria-label="Deactivate TETHER and unlock this tab"><Icon name="power" /></button></div>
    </motion.main>
  )
}

function NavigationDrawer({ open, active, theme, onClose, onHome, onAdvanced, onReplay, onTheme }) {
  const drawerRef = React.useRef(null)
  React.useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    drawerRef.current?.focus()
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [onClose, open])
  return (
    <AnimatePresence>
      {open && (
        <motion.aside ref={drawerRef} className="navigation-drawer" role="dialog" aria-modal="true" aria-label="TETHER navigation" tabIndex={-1} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}>
          <div className="drawer-header"><div className="product-brand"><TetherMark inverted /><span>TETHER</span></div><button type="button" className="round-button" onClick={onClose} aria-label="Close menu"><Icon name="close" /></button></div>
          <nav>
            <button type="button" onClick={onHome}><span>01</span><strong>{active ? 'Current endpoint' : 'Setup'}</strong><Icon name="chevron" /></button>
            <button type="button" onClick={onAdvanced}><span>02</span><strong>Tools & diagnostics</strong><Icon name="chevron" /></button>
            <button type="button" onClick={onReplay}><span>03</span><strong>Replay opening</strong><Icon name="refresh" /></button>
            <button type="button" onClick={onTheme}><span>04</span><strong>{theme === 'dark' ? 'Use light mode' : 'Use dark mode'}</strong><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          </nav>
          <footer><TetherMark inverted /><p>One continuous line<br />through the open web.</p><span>Product UI branch · MV3</span></footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export default function TetherProductUI(props) {
  const [theme, setTheme] = React.useState(() => localStorage.getItem('tetherTheme') || (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [openingVisible, setOpeningVisible] = React.useState(true)
  const [liveReady, setLiveReady] = React.useState(false)
  const appRef = React.useRef(null)
  const menuButtonRef = React.useRef(null)
  const active = props.state.activation?.state === 'active'

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('tetherTheme', theme)
    globalThis.chrome?.runtime?.sendMessage({ type: 'tether.theme.set', theme }).catch(() => {})
  }, [theme])

  React.useEffect(() => {
    if (!openingVisible) return undefined
    const timer = setTimeout(() => setOpeningVisible(false), 520)
    return () => clearTimeout(timer)
  }, [openingVisible])

  React.useEffect(() => {
    let timer = null
    const clear = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      setLiveReady(false)
    }
    const arm = () => {
      clear()
      if (!active || props.connectionState !== 'connected' || document.visibilityState !== 'visible') return
      timer = setTimeout(() => setLiveReady(true), 1000)
    }
    const onVisibility = () => arm()
    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, props.connectionState, props.state.tabId])

  const replayOpening = React.useCallback(() => {
    setMenuOpen(false)
    setOpeningVisible(true)
  }, [])
  const toggleTheme = React.useCallback((event) => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    const target = event?.currentTarget
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!target || reducedMotion || typeof document.startViewTransition !== 'function') {
      setTheme(nextTheme)
      return
    }

    const bounds = target.getBoundingClientRect()
    const originX = bounds.left + (bounds.width / 2)
    const originY = bounds.top + (bounds.height / 2)
    const radius = Math.hypot(
      Math.max(originX, innerWidth - originX),
      Math.max(originY, innerHeight - originY),
    )
    const root = document.documentElement
    root.style.setProperty('--theme-origin-x', `${originX}px`)
    root.style.setProperty('--theme-origin-y', `${originY}px`)
    root.style.setProperty('--theme-reveal-radius', `${radius}px`)

    try {
      document.startViewTransition(() => {
        flushSync(() => setTheme(nextTheme))
      })
    } catch {
      setTheme(nextTheme)
    }
  }, [theme])
  const closeMenu = React.useCallback(() => setMenuOpen(false), [])

  React.useEffect(() => {
    const blocked = menuOpen || openingVisible || Boolean(props.connectionMoment)
    if (!appRef.current) return
    appRef.current.inert = blocked
    if (blocked) appRef.current.setAttribute('aria-hidden', 'true')
    else appRef.current.removeAttribute('aria-hidden')
  }, [menuOpen, openingVisible, props.connectionMoment])

  return (
    <div className={`product-shell${active ? ' product-shell--active' : ''}`}>
      <div className="product-app" ref={appRef}>
        <Header active={active} theme={theme} onTheme={toggleTheme} onMenu={() => setMenuOpen(true)} menuButtonRef={menuButtonRef} />
        <AnimatePresence mode="wait">
          {active ? <ActiveSurface key="active" {...props} active={active} liveReady={liveReady} advancedOpen={advancedOpen} onToggleAdvanced={() => setAdvancedOpen((open) => !open)} /> : <SetupSurface key="setup" {...props} advancedOpen={advancedOpen} onToggleAdvanced={() => setAdvancedOpen((open) => !open)} />}
        </AnimatePresence>
      </div>
      <NavigationDrawer open={menuOpen} active={active} theme={theme} onClose={closeMenu} onHome={() => { setMenuOpen(false); document.querySelector(active ? '.active-scroll' : '.setup-surface')?.scrollTo?.({ top: 0, behavior: 'smooth' }) }} onAdvanced={() => { setAdvancedOpen(true); setMenuOpen(false); setTimeout(() => document.querySelector('.advanced-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }} onReplay={replayOpening} onTheme={toggleTheme} />
      <OpeningExperience visible={openingVisible} />
      <AnimatePresence>{props.connectionMoment && <ConnectionMoment key={props.connectionMoment.id} moment={props.connectionMoment} />}</AnimatePresence>
    </div>
  )
}
