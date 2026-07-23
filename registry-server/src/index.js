import { createRegistryServer } from './app.js'
import { createRegistryCatalog } from './catalog.js'
import { loadConfig } from './config.js'
import { createRegistryDatabase } from './database.js'
import { createMongoRegistryDatabase } from './mongodb-database.js'
import { createOperationalStore } from './operational-store.js'

const config = loadConfig()
if (config.durableStoreRequired && !config.mongodbUri) {
  throw new Error('MONGODB_URI is required when DURABLE_STORE_REQUIRED=true')
}
const database = config.mongodbUri
  ? await createMongoRegistryDatabase({
      uri: config.mongodbUri,
      databaseName: config.mongodbDatabaseName,
    })
  : createRegistryDatabase({ path: config.databasePath })
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
  await database.close()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
