const root = document.documentElement
const page = document.body.dataset.page || 'home'
const themeToggle = document.querySelector('.theme-toggle')
const menuToggle = document.querySelector('.menu-toggle')
const savedTheme = localStorage.getItem('tether-site-theme')
const preferredTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

function applyTheme(theme, persist = true) {
  root.dataset.theme = theme
  if (persist) localStorage.setItem('tether-site-theme', theme)
  themeToggle?.setAttribute('aria-pressed', String(theme === 'dark'))
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === 'dark' ? '#171714' : '#f2eee3')
}

applyTheme(savedTheme || preferredTheme, Boolean(savedTheme))

themeToggle?.addEventListener('click', (event) => {
  const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark'
  if (reducedMotion || typeof document.startViewTransition !== 'function') {
    applyTheme(nextTheme)
    return
  }

  const bounds = event.currentTarget.getBoundingClientRect()
  const originX = bounds.left + bounds.width / 2
  const originY = bounds.top + bounds.height / 2
  const radius = Math.hypot(
    Math.max(originX, innerWidth - originX),
    Math.max(originY, innerHeight - originY),
  )
  root.style.setProperty('--theme-origin-x', `${originX}px`)
  root.style.setProperty('--theme-origin-y', `${originY}px`)
  root.style.setProperty('--theme-radius', `${radius}px`)
  document.startViewTransition(() => applyTheme(nextTheme))
})

menuToggle?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open')
  menuToggle.setAttribute('aria-expanded', String(open))
})

for (const link of document.querySelectorAll('.nav-links a')) {
  if (link.dataset.nav === page) link.setAttribute('aria-current', 'page')
  link.addEventListener('click', () => {
    document.body.classList.remove('nav-open')
    menuToggle?.setAttribute('aria-expanded', 'false')
  })
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const original = button.textContent
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      button.textContent = 'Copied'
      button.classList.add('is-copied')
    } catch {
      button.textContent = 'Select text'
    }
    setTimeout(() => {
      button.textContent = original
      button.classList.remove('is-copied')
    }, 1500)
  })
}

if (!reducedMotion && 'IntersectionObserver' in globalThis) {
  root.classList.add('motion-ready')
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element))
}

async function loadRegistryStatus() {
  const statusItems = document.querySelectorAll('[data-registry-state]')
  const version = document.querySelector('#registry-version')
  const providers = document.querySelector('#provider-list')
  const providerCount = document.querySelector('#provider-count')

  try {
    const [healthResponse, indexResponse] = await Promise.all([
      fetch('/healthz', { headers: { accept: 'application/json' } }),
      fetch('/v1/adapters/index.json', { headers: { accept: 'application/json' } }),
    ])
    if (!healthResponse.ok || !indexResponse.ok) throw new Error('Registry unavailable')

    const [health, index] = await Promise.all([
      healthResponse.json(),
      indexResponse.json(),
    ])
    const ready = health.status === 'ok' && health.operationalStore?.ready
    for (const item of statusItems) {
      item.classList.toggle('is-online', ready)
      const label = item.querySelector('b')
      if (label) label.textContent = ready ? 'Registry online' : 'Registry degraded'
    }

    const publishedProviders = Object.values(index.providers)
    if (version) version.textContent = `v${index.registryVersion}`
    if (providerCount) providerCount.textContent = String(publishedProviders.length)
    if (providers) {
      providers.replaceChildren(...publishedProviders.map((provider) => {
        const item = document.createElement('span')
        item.textContent = new URL(provider.origin).hostname.replace(/^chat\./, '')
        return item
      }))
    }
  } catch {
    for (const item of statusItems) {
      const label = item.querySelector('b')
      if (label) label.textContent = 'Registry waking'
    }
    if (providers) providers.textContent = 'Free service cold-starting'
  }
}

const year = document.querySelector('#year')
if (year) year.textContent = String(new Date().getFullYear())
loadRegistryStatus()
