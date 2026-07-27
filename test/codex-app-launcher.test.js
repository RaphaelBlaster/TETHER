import assert from 'node:assert/strict'
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  activateTetherCodexApp,
  createTetherCodexAppConfig,
  resolveCodexAppCommand,
  restoreCodexAppConfig,
  runCodexAppLaunch,
} from '../lib/codex-app-launcher.js'

test('Codex App activation backs up the original config and writes a secret-free TETHER config', async (t) => {
  const fixture = await createFixture(t)
  const original = 'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\n'
  await mkdir(fixture.codexHome, { recursive: true })
  await writeFile(fixture.configPath, original)
  await writeFile(fixture.apiTokenPath, `${'s'.repeat(43)}\n`)

  const activated = await activateTetherCodexApp(fixture.options)
  const active = await readFile(fixture.configPath, 'utf8')
  const backup = await readFile(activated.paths.backupPath, 'utf8')
  const catalog = JSON.parse(await readFile(activated.paths.modelCatalogPath, 'utf8'))

  assert.equal(activated.alreadyActive, false)
  assert.equal(backup, original)
  assert.match(active, /model = "tether-browser"/)
  assert.match(active, /model_provider = "tether_xpose"/)
  assert.match(active, /auth-helper\.js/)
  assert.doesNotMatch(active, /gpt-5\.6-terra|ssssssss/)
  assert.equal(catalog.models[0].slug, 'tether-browser')

  const second = await activateTetherCodexApp(fixture.options)
  assert.equal(second.alreadyActive, true)
  assert.equal(await readFile(second.paths.backupPath, 'utf8'), original)
})

test('Codex App restore reinstates the original config byte-for-byte', async (t) => {
  const fixture = await createFixture(t)
  const original = '# personal config\r\nmodel = "gpt-5.6-sol"\r\n'
  await mkdir(fixture.codexHome, { recursive: true })
  await writeFile(fixture.configPath, original)
  await activateTetherCodexApp(fixture.options)

  const restored = await restoreCodexAppConfig(fixture.options)
  assert.equal(restored.restored, true)
  assert.equal(restored.preservedActiveConfigPath, null)
  assert.equal(await readFile(fixture.configPath, 'utf8'), original)

  const again = await restoreCodexAppConfig(fixture.options)
  assert.deepEqual({ restored: again.restored, reason: again.reason }, {
    restored: false,
    reason: 'not-active',
  })
})

test('Codex App restore removes a managed config when no original existed', async (t) => {
  const fixture = await createFixture(t)
  await activateTetherCodexApp(fixture.options)
  await restoreCodexAppConfig(fixture.options)
  await assert.rejects(readFile(fixture.configPath, 'utf8'), { code: 'ENOENT' })
})

test('Codex App restore preserves edits made while TETHER mode was active', async (t) => {
  const fixture = await createFixture(t)
  await mkdir(fixture.codexHome, { recursive: true })
  await writeFile(fixture.configPath, 'model = "normal"\n')
  await activateTetherCodexApp(fixture.options)
  await appendFile(fixture.configPath, 'custom_setting = true\n')

  const restored = await restoreCodexAppConfig(fixture.options)
  assert.ok(restored.preservedActiveConfigPath)
  assert.match(await readFile(restored.preservedActiveConfigPath, 'utf8'), /custom_setting = true/)
  assert.equal(await readFile(fixture.configPath, 'utf8'), 'model = "normal"\n')
})

test('Codex App command activates or restores without launching when requested', async (t) => {
  const fixture = await createFixture(t)
  const lines = []
  const options = {
    ...fixture.options,
    launch: false,
    cwd: fixture.root,
    output: { log(line) { lines.push(line) } },
  }
  assert.equal(await runCodexAppLaunch([], options), 0)
  assert.match(lines.join('\n'), /Codex App model: TETHER Browser/)
  assert.equal(await runCodexAppLaunch(['--restore'], options), 0)
  assert.match(lines.join('\n'), /Restored the previous Codex App configuration/)
})

test('Codex App command restores the previous config when launching throws', async (t) => {
  const fixture = await createFixture(t)
  await mkdir(fixture.codexHome, { recursive: true })
  await writeFile(fixture.configPath, 'model = "normal"\n')
  await assert.rejects(
    runCodexAppLaunch([], {
      ...fixture.options,
      launchImpl: async () => { throw new Error('launcher unavailable') },
      output: { log() {} },
    }),
    /launcher unavailable; the previous Codex configuration was restored/,
  )
  assert.equal(await readFile(fixture.configPath, 'utf8'), 'model = "normal"\n')
})

test('Codex App executable discovery prefers the newest desktop-managed Codex binary', async (t) => {
  const fixture = await createFixture(t)
  const binRoot = join(fixture.root, 'OpenAI', 'Codex', 'bin')
  const older = join(binRoot, 'older')
  const newer = join(binRoot, 'newer')
  await mkdir(older, { recursive: true })
  await mkdir(newer, { recursive: true })
  await writeFile(join(older, 'codex.exe'), '')
  await writeFile(join(newer, 'codex.exe'), '')
  const command = await resolveCodexAppCommand({
    platform: 'win32',
    localAppData: fixture.root,
    statImpl: async (path) => ({
      isFile: () => true,
      mtimeMs: path.includes('newer') ? 2 : 1,
    }),
  })
  assert.equal(command.executable, join(newer, 'codex.exe'))
  assert.deepEqual(command.prefixArgs, [])
})

test('generated Codex App config uses command-backed auth instead of embedding the API key', () => {
  const config = createTetherCodexAppConfig({
    modelCatalogPath: 'C:\\state\\catalog.json',
    apiTokenPath: 'C:\\state\\xpose-api-token',
    authCommand: 'C:\\Program Files\\nodejs\\node.exe',
    authHelperPath: 'C:\\tether\\print-xpose-api-token.js',
  })
  assert.match(config, /command = "C:\\\\Program Files\\\\nodejs\\\\node\.exe"/)
  assert.match(config, /args = \["C:\\\\tether\\\\print-xpose-api-token\.js", "C:\\\\state\\\\xpose-api-token"\]/)
  assert.doesNotMatch(config, /Bearer|API key:/)
})

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tether-codex-app-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const codexHome = join(root, 'codex')
  const stateRoot = join(root, 'tether')
  const configPath = join(codexHome, 'config.toml')
  const apiTokenPath = join(stateRoot, 'state', 'xpose-api-token')
  await mkdir(join(stateRoot, 'state'), { recursive: true })
  return {
    root,
    codexHome,
    stateRoot,
    configPath,
    apiTokenPath,
    options: {
      codexHome,
      stateRoot,
      authCommand: 'node-test',
      authHelperPath: join(root, 'auth-helper.js'),
      now: () => new Date('2026-07-26T12:00:00.000Z'),
    },
  }
}
