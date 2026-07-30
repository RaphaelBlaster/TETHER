import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULT_PORT = 8766

export function extensionPath() {
  return join(packageRoot, 'extension', 'dist')
}

export async function runTetherCli(args, options = {}) {
  if (args[0] === 'extension-path' || args[0] === '--extension-path') {
    console.log(extensionPath())
    return 0
  }
  if (args[0] === '--reset') {
    if (args.length !== 1) throw new Error('The "tether --reset" command does not accept additional arguments.')
    const { resetXposePairingIdentity } = await import('./xpose-pairing.js')
    await resetXposePairingIdentity(options.resetOptions)
    return 0
  }
  if (args[0] === 'xpose') {
    const { runTetherXpose } = await import('./xpose-launcher.js')
    return runTetherXpose(args.slice(1), options.xposeOptions)
  }
  throw new Error(
    `Unknown TETHER command: ${args[0] ?? '(missing)'}. ` +
    'Use "tether xpose", "tether --reset", or "tether extension-path".',
  )
}
