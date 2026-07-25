import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createTetherAdapter } from '../adapter/src/adapter.js'
import { XPOSE_MODEL_ID } from '../adapter/src/xpose-api.js'
import { DEFAULT_PORT } from './launcher.js'
import { loadOrCreateXposeApiToken } from './xpose-api-token.js'
import { createExtensionPairingAuthenticator } from './xpose-pairing.js'

export async function startTetherXpose({
  port = DEFAULT_PORT,
  stateRoot = join(homedir(), '.tether'),
  apiToken,
  rotateApiToken = false,
  loadApiToken = loadOrCreateXposeApiToken,
  createAdapter = createTetherAdapter,
  logger = { error() {} },
} = {}) {
  const stateDirectory = join(stateRoot, 'state')
  await mkdir(stateDirectory, { recursive: true })
  const apiTokenPath = join(stateDirectory, 'xpose-api-token')
  const tokenState = apiToken
    ? { token: apiToken, created: false, rotated: false }
    : await loadApiToken({ path: apiTokenPath, rotate: rotateApiToken })
  const authenticateExtension = createExtensionPairingAuthenticator({
    path: join(stateDirectory, 'xpose-pairing.json'),
  })
  const adapter = createAdapter({
    host: '127.0.0.1',
    port,
    routeResponsesToBrowser: true,
    conversationStatePath: join(stateRoot, 'state', 'xpose-conversations.json'),
    xpose: {
      apiToken: tokenState.token,
      modelId: XPOSE_MODEL_ID,
      authenticateExtension,
      maxConcurrentTurns: 1,
    },
    logger,
  })
  const info = await adapter.start()
  return {
    adapter,
    apiToken: tokenState.token,
    apiTokenPath: apiToken ? null : apiTokenPath,
    apiTokenCreated: tokenState.created,
    apiTokenRotated: tokenState.rotated,
    info,
    modelId: XPOSE_MODEL_ID,
    async stop() {
      await adapter.stop()
    },
  }
}

export async function runTetherXpose(args, options = {}) {
  const rotateApiToken = args.length === 1 && args[0] === '--rotate-key'
  if (args.length > (rotateApiToken ? 1 : 0)) throw new Error(`Unknown XposE option: ${args[0]}`)
  const output = options.output ?? console
  const instance = await startTetherXpose({ ...options, rotateApiToken })
  output.log(`TETHER XposE base URL: ${instance.info.baseUrl}`)
  output.log(`TETHER XposE model: ${instance.modelId}`)
  output.log(`TETHER XposE API key: ${instance.apiToken}`)
  if (instance.apiTokenPath) {
    output.log(`TETHER XposE API key file: ${instance.apiTokenPath}`)
  }
  const session = await waitForEligibleSession(instance.adapter, options.sessionWaitMs ?? 2_000)
  output.log(session
    ? `Browser endpoint: ${session.providerId} · ${session.origin} · ${session.browserSessionId}`
    : 'Browser endpoint: waiting for one activated single TETHER endpoint')

  let stopping = false
  let resolveStopped
  const stopped = new Promise((resolve) => { resolveStopped = resolve })
  const handlers = new Map()
  const stop = async () => {
    if (stopping) return
    stopping = true
    await instance.stop()
    resolveStopped(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => void stop()
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  try {
    return await stopped
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler)
    if (!stopping) await instance.stop()
  }
}

async function waitForEligibleSession(adapter, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  do {
    const sessions = adapter.listExtensionRegistrations()
      .flatMap((registration) => registration.sessions ?? [])
      .filter((session) => session.transportMode === 'XPOSE')
    if (sessions.length === 1) return sessions[0]
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (true)
}
