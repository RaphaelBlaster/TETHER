import { createRegistryServer } from './app.js'
import { createRegistryCatalog } from './catalog.js'
import { loadConfig } from './config.js'
import { createRegistryDatabase } from './database.js'
import { createOperationalStore } from './operational-store.js'

const config = loadConfig()
const database = createRegistryDatabase({ path: config.databasePath })
const operationalStore = await createOperationalStore({
  redisUrl: config.redisUrl,
})
const catalog = createRegistryCatalog({
  root: config.registryRoot,
  cache: operationalStore,
  database,
})
const server = createRegistryServer({
  config,
  database,
  operationalStore,
  catalog,
})

const address = await server.start()
console.log(`TETHER provider registry listening on http://${address.host}:${address.port}`)

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await server.stop()
  await operationalStore.close()
  database.close()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
