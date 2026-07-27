import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexEntryPath, DEFAULT_PORT } from './launcher.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_SCHEMA_VERSION = 1
const MANAGED_MARKER = '# Managed temporarily by TETHER Codex App launcher.'
const MODEL_ID = 'tether-browser'
const PROVIDER_ID = 'tether_xpose'

export function codexAppAuthHelperPath() {
  return join(packageRoot, 'lib', 'print-xpose-api-token.js')
}

export function createTetherModelCatalog() {
  return {
    models: [{
      slug: MODEL_ID,
      display_name: 'TETHER Browser',
      description: 'Browser-hosted model connected through the local TETHER XposE endpoint.',
      default_reasoning_level: 'low',
      supported_reasoning_levels: [{
        effort: 'low',
        description: "Use the browser model's normal reasoning behavior",
      }],
      shell_type: 'shell_command',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      base_instructions: 'You are a coding agent. Use the tools supplied by the Codex harness when they are needed, use returned tool results to continue the task, and provide a final answer only after the task is complete or genuinely blocked.',
      include_skills_usage_instructions: false,
      default_reasoning_summary: 'none',
      support_verbosity: false,
      default_verbosity: 'low',
      truncation_policy: {
        mode: 'tokens',
        limit: 10000,
      },
      supports_parallel_tool_calls: false,
      supports_image_detail_original: false,
      context_window: 128000,
      max_context_window: 128000,
      effective_context_window_percent: 90,
      experimental_supported_tools: [],
      input_modalities: ['text'],
      supports_search_tool: false,
      use_responses_lite: true,
    }],
  }
}

export function createTetherCodexAppConfig({
  modelCatalogPath,
  apiTokenPath,
  authCommand = process.execPath,
  authHelperPath = codexAppAuthHelperPath(),
  port = DEFAULT_PORT,
} = {}) {
  if (!modelCatalogPath) throw new Error('Codex model catalog path is required')
  if (!apiTokenPath) throw new Error('XposE API key path is required')
  return [
    MANAGED_MARKER,
    '# Run `tether launch codex-app --restore` to restore the previous Codex configuration.',
    `model = ${tomlString(MODEL_ID)}`,
    `model_provider = ${tomlString(PROVIDER_ID)}`,
    'model_reasoning_effort = "low"',
    `model_catalog_json = ${tomlString(modelCatalogPath)}`,
    '',
    `[model_providers.${PROVIDER_ID}]`,
    'name = "TETHER XposE"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'wire_api = "responses"',
    'supports_websockets = false',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
    `[model_providers.${PROVIDER_ID}.auth]`,
    `command = ${tomlString(authCommand)}`,
    `args = [${tomlString(authHelperPath)}, ${tomlString(apiTokenPath)}]`,
    'timeout_ms = 5000',
    'refresh_interval_ms = 0',
    '',
  ].join('\n')
}

export async function activateTetherCodexApp({
  codexHome = join(homedir(), '.codex'),
  stateRoot = join(homedir(), '.tether'),
  authCommand = process.execPath,
  authHelperPath = codexAppAuthHelperPath(),
  port = DEFAULT_PORT,
  now = () => new Date(),
} = {}) {
  const paths = launcherPaths({ codexHome, stateRoot })
  await mkdir(paths.launchStateDirectory, { recursive: true })
  await mkdir(dirname(paths.configPath), { recursive: true })

  const existingState = await readJsonIfExists(paths.statePath)
  if (existingState) {
    validateState(existingState, paths)
    const current = await readIfExists(paths.configPath)
    if (current && digest(current) === existingState.activeConfigSha256) {
      return { active: true, alreadyActive: true, paths }
    }
    throw new Error(
      'A TETHER Codex App backup already exists, but the active Codex config changed. ' +
      'Run `tether launch codex-app --restore` before activating again.',
    )
  }

  const originalConfig = await readIfExists(paths.configPath)
  if (originalConfig !== null) {
    await writePrivateFile(paths.backupPath, originalConfig, { exclusive: true })
  }

  const modelCatalog = `${JSON.stringify(createTetherModelCatalog(), null, 2)}\n`
  const activeConfig = createTetherCodexAppConfig({
    modelCatalogPath: paths.modelCatalogPath,
    apiTokenPath: paths.apiTokenPath,
    authCommand,
    authHelperPath,
    port,
  })
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    activatedAt: now().toISOString(),
    configPath: paths.configPath,
    backupPath: originalConfig === null ? null : paths.backupPath,
    originalConfigExisted: originalConfig !== null,
    originalConfigSha256: originalConfig === null ? null : digest(originalConfig),
    activeConfigSha256: digest(activeConfig),
  }

  try {
    await writePrivateFile(paths.modelCatalogPath, modelCatalog)
    await writeJsonAtomic(paths.statePath, state)
    await writePrivateFile(paths.configPath, activeConfig)
  } catch (error) {
    await restoreAfterActivationFailure({ paths, originalConfig })
    throw error
  }

  return { active: true, alreadyActive: false, paths }
}

export async function restoreCodexAppConfig({
  codexHome = join(homedir(), '.codex'),
  stateRoot = join(homedir(), '.tether'),
  now = () => new Date(),
} = {}) {
  const paths = launcherPaths({ codexHome, stateRoot })
  const state = await readJsonIfExists(paths.statePath)
  if (!state) return { restored: false, reason: 'not-active', paths }
  validateState(state, paths)

  const current = await readIfExists(paths.configPath)
  let preservedActiveConfigPath = null
  if (current !== null && digest(current) !== state.activeConfigSha256) {
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    preservedActiveConfigPath = join(paths.launchStateDirectory, `config.tether-edited.${stamp}.toml`)
    await writePrivateFile(preservedActiveConfigPath, current, { exclusive: true })
  }

  if (state.originalConfigExisted) {
    const backup = await readIfExists(paths.backupPath)
    if (backup === null) throw new Error(`Codex configuration backup is missing: ${paths.backupPath}`)
    if (digest(backup) !== state.originalConfigSha256) {
      throw new Error(`Codex configuration backup failed its integrity check: ${paths.backupPath}`)
    }
    await writePrivateFile(paths.configPath, backup)
  } else {
    await rm(paths.configPath, { force: true })
  }

  await rm(paths.statePath, { force: true })
  await rm(paths.backupPath, { force: true })
  return { restored: true, preservedActiveConfigPath, paths }
}

export async function runCodexAppLaunch(args, options = {}) {
  const output = options.output ?? console
  const restore = args.includes('--restore')
  const unknownOptions = args.filter((arg) => arg.startsWith('-') && arg !== '--restore')
  if (unknownOptions.length) throw new Error(`Unknown Codex App launch option: ${unknownOptions[0]}`)
  const workspaceArgs = args.filter((arg) => arg !== '--restore')
  if (workspaceArgs.length > 1) throw new Error('Codex App launch accepts at most one workspace path')
  const workspace = resolve(workspaceArgs[0] ?? options.cwd ?? process.cwd())

  if (restore) {
    const restored = await restoreCodexAppConfig(options)
    output.log(restored.restored
      ? 'Restored the previous Codex App configuration.'
      : 'TETHER Codex App mode was not active; nothing needed restoration.')
    if (restored.preservedActiveConfigPath) {
      output.log(`Preserved the edited TETHER-era config at: ${restored.preservedActiveConfigPath}`)
    }
  } else {
    const activated = await activateTetherCodexApp(options)
    output.log(activated.alreadyActive
      ? 'TETHER Codex App configuration is already active.'
      : `Backed up the previous Codex App configuration under: ${activated.paths.launchStateDirectory}`)
    output.log('Codex App model: TETHER Browser')
    output.log('Restore command: tether launch codex-app --restore')
  }

  if (options.launch === false) return 0
  const launch = options.launchImpl ?? launchCodexApp
  try {
    const exitCode = await launch(workspace, options)
    if (exitCode !== 0 && !restore) {
      throw new Error(`Codex App launcher exited with code ${exitCode}`)
    }
    return exitCode
  } catch (error) {
    if (!restore) {
      await restoreCodexAppConfig(options)
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        'the previous Codex configuration was restored',
        { cause: error },
      )
    }
    throw error
  }
}

export async function launchCodexApp(workspace, {
  spawnImpl = spawn,
  ...options
} = {}) {
  const command = await resolveCodexAppCommand(options)
  const child = spawnImpl(command.executable, [...command.prefixArgs, 'app', workspace], {
    stdio: 'inherit',
    env: process.env,
  })
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolvePromise(signal ? 128 : (code ?? 1)))
  })
}

export async function resolveCodexAppCommand({
  codexPath = process.env.TETHER_CODEX_PATH,
  localAppData = process.env.LOCALAPPDATA,
  platform = process.platform,
  nodePath = process.execPath,
  readdirImpl = readdir,
  statImpl = stat,
} = {}) {
  if (codexPath) return { executable: codexPath, prefixArgs: [] }

  if (platform === 'win32' && localAppData) {
    const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin')
    let entries = []
    try {
      entries = await readdirImpl(binRoot, { withFileTypes: true })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const candidates = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const executable = join(binRoot, entry.name, 'codex.exe')
      try {
        const metadata = await statImpl(executable)
        if (metadata.isFile()) candidates.push({ executable, modifiedAt: metadata.mtimeMs })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)
    if (candidates[0]) return { executable: candidates[0].executable, prefixArgs: [] }
  }

  try {
    return { executable: nodePath, prefixArgs: [codexEntryPath()] }
  } catch {
    return {
      executable: platform === 'win32' ? 'codex.exe' : 'codex',
      prefixArgs: [],
    }
  }
}

function launcherPaths({ codexHome, stateRoot }) {
  const launchStateDirectory = join(stateRoot, 'state', 'codex-app')
  return {
    configPath: join(codexHome, 'config.toml'),
    launchStateDirectory,
    statePath: join(launchStateDirectory, 'state.json'),
    backupPath: join(launchStateDirectory, 'config.toml.backup'),
    modelCatalogPath: join(launchStateDirectory, 'tether-model-catalog.json'),
    apiTokenPath: join(stateRoot, 'state', 'xpose-api-token'),
  }
}

function validateState(state, paths) {
  if (
    state?.schemaVersion !== STATE_SCHEMA_VERSION ||
    state.configPath !== paths.configPath ||
    state.originalConfigExisted !== (state.backupPath !== null) ||
    (state.backupPath !== null && state.backupPath !== paths.backupPath) ||
    typeof state.activeConfigSha256 !== 'string'
  ) {
    throw new Error(`TETHER Codex App restore state is invalid: ${paths.statePath}`)
  }
}

async function restoreAfterActivationFailure({ paths, originalConfig }) {
  if (originalConfig === null) await rm(paths.configPath, { force: true })
  else await writePrivateFile(paths.configPath, originalConfig)
  await rm(paths.statePath, { force: true })
  await rm(paths.backupPath, { force: true })
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function readJsonIfExists(path) {
  const text = await readIfExists(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`TETHER Codex App restore state is not valid JSON: ${path}`)
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`
  await writePrivateFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { exclusive: true })
  await rename(temporary, path)
}

async function writePrivateFile(path, contents, { exclusive = false } = {}) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, {
    encoding: 'utf8',
    flag: exclusive ? 'wx' : 'w',
    mode: 0o600,
  })
  try {
    await chmod(path, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function tomlString(value) {
  return JSON.stringify(String(value))
}
