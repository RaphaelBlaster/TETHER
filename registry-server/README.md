# TETHER provider registry service

This Render-ready Node service publishes the Git-reviewed manifests under
`../provider-adapters` and accepts privacy-safe drift reports.

## State ownership

- Git-managed JSON is the only manifest source of truth.
- MongoDB Atlas stores production drift aggregates, durable maintenance jobs
  and publication observations.
- SQLite provides the same durable-store contract for local development and
  tests without requiring cloud credentials.
- Redis/Valkey stores rate limits, deduplication keys, temporary verified
  manifest bytes and maintenance-job notifications.
- If Redis is unavailable, the service remains functional using process memory.
  MongoDB Atlas and Git retain durable state in production.

## Local development

```powershell
npm --prefix registry-server install
npm run registry:build
npm --prefix registry-server test
npm --prefix registry-server start
```

Redis is optional locally. Set `REDIS_URL=redis://127.0.0.1:6379` to exercise the
production operational path.

## Free Render deployment

The Blueprint runs a stateless Free web service and prompts for two private
environment variables:

- `MONGODB_URI` — MongoDB Atlas driver connection string.
- `REDIS_URL` — Redis Cloud `redis://` or `rediss://` connection URL.

`DURABLE_STORE_REQUIRED=true` prevents production from silently falling back to
ephemeral SQLite if `MONGODB_URI` is missing. Neither connection string belongs
in Git, logs, screenshots, support messages or extension code.

## API

- `GET /healthz`
- `GET /v1/adapters/index.json`
- `GET /v1/adapters/index.sig.json`
- `GET /v1/adapters?origin=https://chatgpt.com`
- `POST /v1/drift-reports`
