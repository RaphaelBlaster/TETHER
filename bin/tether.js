#!/usr/bin/env node

import { runTetherCli } from '../lib/launcher.js'

try {
  process.exitCode = await runTetherCli(process.argv.slice(2))
} catch (error) {
  console.error(`TETHER failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
