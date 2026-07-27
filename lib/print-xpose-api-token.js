#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) {
  console.error('XposE API key path is required')
  process.exitCode = 1
} else {
  try {
    const token = (await readFile(path, 'utf8')).trim()
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Stored XposE API key is invalid')
    process.stdout.write(token)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
