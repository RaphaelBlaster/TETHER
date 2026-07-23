# TETHER provider registry service

This Render-ready Node service publishes the Git-reviewed manifests under
`../provider-adapters` and accepts privacy-safe drift reports.

## State ownership

- Git-managed JSON is the only manifest source of truth.
- SQLite stores drift aggregates, durable maintenance jobs and publication
  observations.
- Redis/Valkey stores rate limits, deduplication keys, temporary verified
  manifest bytes and maintenance-job notifications.
- If Redis is unavailable, the service remains functional using process memory.
  SQLite and Git retain durable state.

## Local development

```powershell
npm --prefix registry-server install
npm run registry:build
npm --prefix registry-server test
npm --prefix registry-server start
```

Redis is optional locally. Set `REDIS_URL=redis://127.0.0.1:6379` to exercise the
production operational path.

## API

- `GET /healthz`
- `GET /v1/adapters/index.json`
- `GET /v1/adapters/index.sig.json`
- `GET /v1/adapters?origin=https://chatgpt.com`
- `POST /v1/drift-reports`
