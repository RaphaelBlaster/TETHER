import { spawn } from 'node:child_process'

export const TETHER_UPDATE_SOURCE =
  'git+https://github.com/RaphaelBlaster/TETHER.git#main'

export function npmUpdateInvocation({
  platform = process.platform,
  env = process.env,
} = {}) {
  const npmArgs = ['install', '--global', TETHER_UPDATE_SOURCE]
  if (platform !== 'win32') return { command: 'npm', args: npmArgs }

  const command = env.ComSpec || env.COMSPEC || 'cmd.exe'
  return {
    command,
    args: [
      '/d',
      '/s',
      '/c',
      `npm install --global "${TETHER_UPDATE_SOURCE}"`,
    ],
  }
}

export async function updateTether({
  platform = process.platform,
  env = process.env,
  output = console,
  spawnImpl = spawn,
} = {}) {
  const invocation = npmUpdateInvocation({ platform, env })
  output.log('Updating TETHER from the official GitHub main branch...')

  const exitCode = await run(invocation, { env, spawnImpl })
  if (exitCode !== 0) {
    throw new Error(`npm exited with code ${exitCode} while updating TETHER.`)
  }

  output.log('TETHER update installed successfully.')
  output.log('Restart any running tether xpose process.')
  output.log('Reload TETHER in chrome://extensions, then refresh the provider tab.')
}

function run({ command, args }, { env, spawnImpl }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(command, args, {
        env,
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }
    child.once('error', reject)
    child.once('close', resolve)
  })
}
