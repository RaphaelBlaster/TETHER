import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function createConversationStateStore({ path } = {}) {
  let loaded = false
  let states = {}
  let writeChain = Promise.resolve()

  async function load() {
    if (loaded) return
    loaded = true
    if (!path) return
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (parsed?.schemaVersion === 1 && parsed.states && typeof parsed.states === 'object') states = parsed.states
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  async function get(key) {
    await load()
    return states[key] ?? null
  }

  async function set(key, value) {
    await load()
    states = { ...states, [key]: value }
    if (!path) return
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, states })}\n`, 'utf8')
      await rename(temporary, path)
    })
    await writeChain
  }

  return { get, set }
}
