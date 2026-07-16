const OWNER_ATTRIBUTE = 'data-tether-calibration-overlay'

function isOwned(element) {
  return Boolean(
    element?.closest?.(`[${OWNER_ATTRIBUTE}]`) ||
      element?.getRootNode?.()?.host?.hasAttribute?.(OWNER_ATTRIBUTE),
  )
}

export function createElementInspector({ document, window, onConfirm, onCancel, onError }) {
  let active = false
  let hovered = null
  let candidate = null
  let path = []
  let pathIndex = 0
  let host = null
  let highlight = null
  let message = null
  let normalizeCandidate = (element) => element

  function setMessage(text) {
    if (message) message.textContent = text
  }

  function updateHighlight(element) {
    hovered = element
    if (!highlight) return
    if (!element) {
      highlight.style.display = 'none'
      return
    }
    const rect = element.getBoundingClientRect()
    Object.assign(highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  function underlyingElement(event) {
    const raw = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => !isOwned(element))
    return normalizeCandidate(raw)
  }

  function onPointerMove(event) {
    if (!active || candidate) return
    updateHighlight(underlyingElement(event))
  }

  function block(event) {
    if (!active) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  function onClick(event) {
    block(event)
    if (!active) return
    const selected = underlyingElement(event) || hovered
    if (!selected) return
    candidate = selected
    path = []
    for (let node = selected; node && node !== document.documentElement; node = node.parentElement) {
      path.push(node)
    }
    pathIndex = 0
    updateHighlight(candidate)
    setMessage('Enter confirms · ↑ parent · ↓ child · Backspace undo · Esc cancel')
  }

  function onKeyDown(event) {
    if (!active) return
    if (event.key === 'Escape') {
      block(event)
      stop()
      onCancel()
      return
    }
    if (!candidate) {
      if (event.key === 'Enter') block(event)
      return
    }
    if (event.key === 'ArrowUp' && pathIndex < path.length - 1) pathIndex += 1
    else if (event.key === 'ArrowDown' && pathIndex > 0) pathIndex -= 1
    else if (event.key === 'Backspace') {
      block(event)
      candidate = null
      path = []
      setMessage('Click the highlighted page element')
      return
    } else if (event.key === 'Enter') {
      block(event)
      try {
        onConfirm(candidate)
      } catch (error) {
        setMessage(`${error.message} · Backspace to choose again · Esc cancels`)
        onError(error)
      }
      return
    } else return
    block(event)
    candidate = path[pathIndex]
    updateHighlight(candidate)
  }

  function start(instruction, normalize = (element) => element) {
    normalizeCandidate = normalize
    if (active) setMessage(instruction)
    else {
      active = true
      host = document.createElement('div')
      host.setAttribute(OWNER_ATTRIBUTE, '')
      Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' })
      const shadow = host.attachShadow({ mode: 'closed' })
      highlight = document.createElement('div')
      Object.assign(highlight.style, {
        position: 'fixed', boxSizing: 'border-box', border: '2px solid #7c5cff',
        background: 'rgba(82,39,255,.14)', borderRadius: '5px', pointerEvents: 'none',
      })
      message = document.createElement('div')
      Object.assign(message.style, {
        position: 'fixed', left: '50%', top: '18px', transform: 'translateX(-50%)',
        maxWidth: 'min(560px, calc(100vw - 32px))', padding: '10px 14px', borderRadius: '999px',
        color: '#fff', background: 'rgba(9,7,18,.92)', font: '600 13px system-ui',
        boxShadow: '0 10px 32px rgba(0,0,0,.32)', pointerEvents: 'none',
      })
      shadow.append(highlight, message)
      document.documentElement.append(host)
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('pointerdown', block, true)
      document.addEventListener('click', onClick, true)
      window.addEventListener('keydown', onKeyDown, true)
      setMessage(instruction)
    }
    candidate = null
    path = []
    updateHighlight(null)
  }

  function stop() {
    if (!active) return
    active = false
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerdown', block, true)
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKeyDown, true)
    host?.remove()
    host = highlight = message = hovered = candidate = null
    normalizeCandidate = (element) => element
    path = []
  }

  return { start, stop, isActive: () => active }
}
