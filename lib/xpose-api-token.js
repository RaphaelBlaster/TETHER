import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export async function loadOrCreateXposeApiToken({
  path,
  rotate = false,
  generateToken = () => randomBytes(32).toString('base64url'),
} = {}) {
  if (typeof path !== 'string' || !path) throw new Error('XposE API key path is required')
  await mkdir(dirname(path), { recursive: true })

  if (!rotate) {
    const existing = await readToken(path)
    if (existing) {
      await protectFile(path)
      return { token: existing, created: false, rotated: false }
    }
  }

  const token = generateToken()
  if (!API_TOKEN_PATTERN.test(token)) throw new Error('Generated XposE API key is invalid')

  if (rotate) {
    await writeFile(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  } else {
    try {
      await writeFile(path, `${token}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const raced = await readToken(path)
      if (!raced) throw new Error('XposE API key was not available after concurrent creation')
      await protectFile(path)
      return { token: raced, created: false, rotated: false }
    }
  }

  await protectFile(path)
  return { token, created: !rotate, rotated: rotate }
}

async function readToken(path) {
  try {
    const token = (await readFile(path, 'utf8')).trim()
    if (!API_TOKEN_PATTERN.test(token)) {
      throw Object.assign(
        new Error('Stored XposE API key is invalid; run tether xpose --rotate-key to replace it'),
        { code: 'invalid_xpose_api_key' },
      )
    }
    return token
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function protectFile(path) {
  try {
    await chmod(path, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}
