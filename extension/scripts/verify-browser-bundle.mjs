import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const dist = new URL('../dist/', import.meta.url)
const files = await collect(dist)
const javascript = files.filter((file) => file.pathname.endsWith('.js'))
const forbidden = /__vite-browser-external|node:(?:child_process|fs|os|path)|@puppeteer\/browsers/

for (const file of javascript) {
  const source = await readFile(file, 'utf8')
  assert.doesNotMatch(
    source,
    forbidden,
    `${path.basename(file.pathname)} must not bundle Puppeteer's Node-only transports or browser launcher`,
  )
}

const contentScript = await readFile(new URL('content-script.js', dist), 'utf8')
const background = await readFile(new URL('background.js', dist), 'utf8')
assert.doesNotMatch(
  contentScript,
  /^\s*(?:import|export)\b/m,
  'content-script.js must be one self-contained classic script for chrome.scripting.executeScript',
)
assert.match(contentScript, /blur-field-in/, 'content-script.js must preserve the center-out guard blur reveal')
assert.match(contentScript, /blur-field-out/, 'content-script.js must preserve the coordinated guard blur release')
assert.match(contentScript, /is-releasing/, 'content-script.js must preserve its stale-state release guard')
assert.match(contentScript, /tether\.theme\.set/, 'content-script.js must synchronize protected-page theme messages')
assert.match(background, /tether\.theme\.set/, 'background.js must relay theme changes to protected tabs')
assert.match(background, /TRUSTED_CONTEXTS/, 'background.js must keep extension storage restricted to trusted contexts')

console.log(`Verified ${javascript.length} extension JavaScript bundles contain no Node-only Puppeteer branches`)

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? collect(child) : [child]
  }))
  return nested.flat()
}
