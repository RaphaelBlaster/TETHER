import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULT_PORT = 8766
export const DEFAULT_CODEX_ARGS = [
  '-m', 'tether-compact',
  '-c', 'model_provider="tether"',
  '-c', 'model_providers.tether.name="TETHER local adapter"',
  '-c', `model_providers.tether.base_url="http://127.0.0.1:${DEFAULT_PORT}/v1"`,
  '-c', 'model_providers.tether.wire_api="responses"',
  '-c', 'model_providers.tether.supports_websockets=true',
  '-c', 'model_providers.tether.requires_openai_auth=false',
  '-c', 'model_providers.tether.request_max_retries=0',
  '-c', 'model_providers.tether.stream_max_retries=0',
]

export function extensionPath() {
  return join(packageRoot, 'extension', 'dist')
}

export function adapterEntryPath() {
  return join(packageRoot, 'adapter', 'src', 'cli.js')
}

export function codexEntryPath() {
  return join(dirname(require.resolve('@openai/codex/package.json')), 'bin', 'codex.js')
}

export async function probeAdapter({ port = DEFAULT_PORT, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/tether/health`, {
      signal: AbortSignal.timeout(750),
    })
    const body = await response.json()
    const currentContract = response.ok && body?.status === 'ok' && body?.service === 'tether-adapter'
    const legacyContract = response.status === 404
      && body?.error === '/v1/models and HTTP Responses are unsupported in Checkpoint 8C'
    return currentContract || legacyContract
  } catch {
    return false
  }
}

export async function waitForAdapter({ child, port = DEFAULT_PORT, timeoutMs = 10_000, probe = probeAdapter } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('the embedded adapter exited during startup')
    }
    if (await probe({ port })) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`the embedded adapter did not become ready on 127.0.0.1:${port}`)
}

export async function stopChild(child, timeoutMs = 3_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise))
  const timedOut = new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), timeoutMs))
  if (await Promise.race([exited, timedOut]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL')
  }
}

export async function runTetherCli(args, options = {}) {
  if (args[0] === 'extension-path' || args[0] === '--extension-path') {
    console.log(extensionPath())
    return 0
  }

  const spawnImpl = options.spawnImpl ?? spawn
  const probe = options.probe ?? probeAdapter
  const port = options.port ?? DEFAULT_PORT
  const stateRoot = options.stateRoot ?? join(homedir(), '.tether')
  await mkdir(stateRoot, { recursive: true })

  let adapter = null
  const adapterAlreadyRunning = await probe({ port })
  if (!adapterAlreadyRunning) {
    adapter = spawnImpl(process.execPath, [adapterEntryPath()], {
      cwd: stateRoot,
      env: { ...process.env, TETHER_ADAPTER_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let startupError = ''
    adapter.stderr?.on('data', (chunk) => {
      startupError = `${startupError}${chunk}`.slice(-4000)
    })
    try {
      await waitForAdapter({ child: adapter, port, probe })
    } catch (error) {
      await stopChild(adapter)
      const detail = startupError.trim() ? `\n${startupError.trim()}` : ''
      throw new Error(`${error.message}${detail}`)
    }
  }

  console.error(adapterAlreadyRunning
    ? 'TETHER adapter is already online.'
    : 'TETHER adapter started automatically.')

  const codexArgs = port === DEFAULT_PORT
    ? [...DEFAULT_CODEX_ARGS, ...args]
    : DEFAULT_CODEX_ARGS.map((value) => value.replace(`:${DEFAULT_PORT}/v1`, `:${port}/v1`)).concat(args)
  const codex = spawnImpl(process.execPath, [codexEntryPath(), ...codexArgs], {
    stdio: 'inherit',
    env: process.env,
  })

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    if (codex.exitCode === null && codex.signalCode === null) codex.kill(signal)
    await stopChild(adapter)
  }
  const signalHandlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => void shutdown(signal)
    signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }

  try {
    const result = await new Promise((resolvePromise, reject) => {
      codex.once('error', reject)
      codex.once('exit', (code, signal) => resolvePromise({ code, signal }))
    })
    await stopChild(adapter)
    if (result.signal) return 128
    return result.code ?? 1
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler)
    await stopChild(adapter)
  }
}
