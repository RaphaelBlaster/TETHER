import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../dist/content-script.js', import.meta.url), 'utf8')

assert.doesNotMatch(source, /^\s*import\b/m, 'injectable content-script.js must not contain imports')
// React's development diagnostics contain literal example text such as
// `import('./MyComponent')`; a raw substring check reports that quoted text as
// executable syntax. The IIFE build and static-import assertion are the
// relevant classic-script packaging guarantees here.
assert.match(source, /calibration\.start/, 'content-script.js must contain the calibration message listener')
assert.match(source, /removeListener/, 'content-script.js must unregister a superseded runtime listener')
assert.match(source, /__tetherContentScriptCleanup/, 'content-script.js must expose version replacement cleanup')
assert.match(source, /extraction\.execute\.v2/, 'content-script.js must isolate extraction messages from legacy listeners')

console.log('Verified dist/content-script.js is a standalone classic script')
