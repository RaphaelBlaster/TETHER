const root = document.documentElement
const themeToggle = document.querySelector('.theme-toggle')
const savedTheme = localStorage.getItem('tether-site-theme')
const preferredTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

function setTheme(theme) {
  root.dataset.theme = theme
  localStorage.setItem('tether-site-theme', theme)
  themeToggle?.setAttribute('aria-pressed', String(theme === 'dark'))
}

setTheme(savedTheme || preferredTheme)

themeToggle?.addEventListener('click', () => {
  setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')
})

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const original = button.textContent
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select command'
    }
    setTimeout(() => {
      button.textContent = original
    }, 1600)
  })
}

async function loadRegistryStatus() {
  const status = document.querySelector('#registry-status')
  const version = document.querySelector('#registry-version')
  const providers = document.querySelector('#provider-list')

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
    status?.classList.add('is-online')
    const label = status?.querySelector('b')
    if (label) label.textContent = health.operationalStore?.ready ? 'Registry online' : 'Registry degraded'
    if (version) version.textContent = `v${index.registryVersion}`

    if (providers) {
      providers.replaceChildren(...Object.values(index.providers).map((provider) => {
        const item = document.createElement('span')
        item.textContent = new URL(provider.origin).hostname.replace(/^chat\./, '')
        return item
      }))
    }
  } catch {
    const label = status?.querySelector('b')
    if (label) label.textContent = 'Registry waking'
    if (providers) providers.textContent = 'The free service may be cold-starting.'
  }
}

document.querySelector('#year').textContent = String(new Date().getFullYear())
loadRegistryStatus()
