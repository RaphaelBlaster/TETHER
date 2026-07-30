import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export async function resetXposePairingIdentity({
  stateRoot = join(homedir(), '.tether'),
  output = console,
  unlinkImpl = unlink,
} = {}) {
  const path = join(stateRoot, 'state', 'xpose-pairing.json')
  let removed = true
  try {
    await unlinkImpl(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    removed = false
  }
  output.log(removed
    ? `TETHER pairing identity reset: ${path}`
    : `TETHER pairing identity is already reset: ${path}`)
  output.log('Pairing is enabled. Start or restart "tether xpose", then activate the extension endpoint.')
  return { path, removed }
}

export function createExtensionPairingAuthenticator({ path } = {}) {
  if (typeof path !== 'string' || !path) throw new Error('Pairing state path is required')
  let statePromise = null
  let writeChain = Promise.resolve()
  let authenticationChain = Promise.resolve()

  async function load() {
    if (!statePromise) {
      statePromise = readFile(path, 'utf8').then((text) => {
        const parsed = JSON.parse(text)
        if (
          parsed?.schemaVersion !== 1 ||
          typeof parsed.extensionInstanceId !== 'string' ||
          typeof parsed.origin !== 'string' ||
          !/^[a-f0-9]{64}$/.test(parsed.tokenSha256)
        ) throw coded('invalid_pairing_state', 'Stored extension pairing state is invalid')
        return parsed
      }).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
    }
    return statePromise
  }

  return function authenticate(candidate) {
    const result = authenticationChain.then(() => authenticateOnce(candidate))
    authenticationChain = result.catch(() => {})
    return result
  }

  async function authenticateOnce({ extensionInstanceId, pairingToken, origin }) {
    if (!validExtensionOrigin(origin)) {
      throw coded('invalid_extension_origin', 'XposE accepts the TETHER Chrome extension origin only')
    }
    if (typeof extensionInstanceId !== 'string' || !extensionInstanceId ||
        typeof pairingToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairingToken)) {
      throw coded('extension_pairing_required', 'A valid extension pairing proof is required')
    }
    const tokenSha256 = digest(pairingToken)
    const current = await load()
    if (!current) {
      const paired = {
        schemaVersion: 1,
        extensionInstanceId,
        origin,
        tokenSha256,
        pairedAt: new Date().toISOString(),
      }
      writeChain = writeChain.then(() => writePairing(path, paired))
      await writeChain
      statePromise = Promise.resolve(paired)
      return { paired: true, firstPairing: true }
    }
    if (
      current.extensionInstanceId !== extensionInstanceId ||
      current.origin !== origin ||
      !safeEqual(current.tokenSha256, tokenSha256)
    ) {
      throw coded('extension_pairing_mismatch', 'Extension pairing proof does not match the trusted installation')
    }
    return { paired: true, firstPairing: false }
  }
}

async function writePairing(path, state) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

function validExtensionOrigin(origin) {
  return typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
