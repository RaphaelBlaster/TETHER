import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DEFAULT_PORT, extensionPath, runTetherCli } from '../lib/launcher.js'
import { npmUpdateInvocation, TETHER_UPDATE_SOURCE } from '../lib/updater.js'

test('launcher exposes only the XposE port and packaged extension path', () => {
  assert.equal(DEFAULT_PORT, 8766)
  assert.match(extensionPath(), /extension[\\/]dist$/)
})

test('tether --reset removes only pairing identity and is idempotent', async (t) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'tether-reset-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const stateDirectory = join(stateRoot, 'state')
  const pairingPath = join(stateDirectory, 'xpose-pairing.json')
  const tokenPath = join(stateDirectory, 'xpose-api-token')
  await mkdir(stateDirectory, { recursive: true })
  await writeFile(pairingPath, '{"trusted":true}\n')
  await writeFile(tokenPath, 'persistent-api-token\n')
  const messages = []
  const resetOptions = { stateRoot, output: { log: (message) => messages.push(message) } }

  assert.equal(await runTetherCli(['--reset'], { resetOptions }), 0)
  await assert.rejects(stat(pairingPath), { code: 'ENOENT' })
  assert.equal(await readFile(tokenPath, 'utf8'), 'persistent-api-token\n')
  assert.match(messages.join('\n'), /Pairing is enabled/)

  assert.equal(await runTetherCli(['--reset'], { resetOptions }), 0)
  assert.match(messages.at(-2), /already reset/)
})

test('tether --reset does not hide an unexpected filesystem failure', async () => {
  const failure = Object.assign(new Error('access denied'), { code: 'EACCES' })
  await assert.rejects(
    runTetherCli(['--reset'], {
      resetOptions: {
        stateRoot: 'unused',
        output: { log() {} },
        unlinkImpl: async () => { throw failure },
      },
    }),
    { code: 'EACCES', message: 'access denied' },
  )
})

test('tether --update installs only the official GitHub main branch globally', async () => {
  let captured
  const messages = []
  const child = new EventEmitter()
  const updateOptions = {
    platform: 'linux',
    env: { PATH: '/test/bin' },
    output: { log: (message) => messages.push(message) },
    spawnImpl(command, args, options) {
      captured = { command, args, options }
      queueMicrotask(() => child.emit('close', 0))
      return child
    },
  }

  assert.equal(await runTetherCli(['--update'], { updateOptions }), 0)
  assert.equal(captured.command, 'npm')
  assert.deepEqual(captured.args, ['install', '--global', TETHER_UPDATE_SOURCE])
  assert.equal(captured.options.shell, false)
  assert.equal(captured.options.stdio, 'inherit')
  assert.deepEqual(captured.options.env, updateOptions.env)
  assert.match(messages.join('\n'), /Reload TETHER in chrome:\/\/extensions/)
})

test('Windows updater uses the command processor without accepting user command text', () => {
  assert.deepEqual(
    npmUpdateInvocation({ platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        `npm install --global "${TETHER_UPDATE_SOURCE}"`,
      ],
    },
  )
})

test('tether --update reports npm failures', async () => {
  const child = new EventEmitter()
  await assert.rejects(
    runTetherCli(['--update'], {
      updateOptions: {
        platform: 'linux',
        output: { log() {} },
        spawnImpl() {
          queueMicrotask(() => child.emit('close', 7))
          return child
        },
      },
    }),
    /npm exited with code 7/,
  )
})

test('launcher rejects removed Codex entry points and invalid reset arguments', async () => {
  await assert.rejects(
    runTetherCli([]),
    /Use "tether xpose"/,
  )
  await assert.rejects(
    runTetherCli(['launch', 'codex-app']),
    /Unknown TETHER command: launch/,
  )
  await assert.rejects(
    runTetherCli(['--reset', 'unexpected']),
    /does not accept additional arguments/,
  )
  await assert.rejects(
    runTetherCli(['--update', 'unexpected']),
    /does not accept additional arguments/,
  )
})
