# Declarative provider adapters

TETHER's installed extension owns every automation operation. Provider adapters
are versioned JSON data only: origin-scoped selectors plus completion signals.
They cannot provide JavaScript, event handlers, URLs to execute, or control flow.

## Trust boundary

`provider-adapter-registry.js` validates an adapter before it enters the
last-known-good cache. Validation is strict:

- schema, adapter, and engine versions must be supported integers;
- the manifest origin must exactly equal the browser page origin;
- unknown fields are rejected at every schema level;
- selector lists, selector length, and total serialized bytes are bounded;
- unsafe selector characters are rejected;
- fetching is GET-only, omits credentials, rejects redirects, and is bounded by
  a caller-enforced timeout and response-size limit.

The direct-CDP engine then validates a remotely sourced adapter against the live
page. A candidate must resolve exactly one composer and no more than one Send
control before it may control the page. Failed live validation rolls the active
cache pointer back to the preceding accepted version. Packaged adapters remain
available if the registry, cache, or candidate fails.

There is deliberately no production registry endpoint in this checkpoint. The
registry accepts a fetch interface, and the HTTP client accepts an
`endpointForOrigin` function, so tests and later deployment can supply an
approved API/CDN without hard-coding or trusting an unreviewed service. Redis is
not required by the extension and must not become the durable manifest source.

## Storage and rollback

Accepted manifests are stored under
`chrome.storage.local.providerAdapterCacheV1`. Each origin keeps a bounded
version history, an active version, an ETag, and the preceding active version.
`rollback(origin, version)` selects a cached or packaged version without
deleting newer history. Calibration profiles remain separate under
`chrome.storage.local.calibrationProfiles`.

## Privacy-safe drift metadata

`createDriftReport()` constructs the complete allowed payload:

```json
{
  "origin": "https://example.com",
  "adapterVersion": 3,
  "extensionVersion": "0.1.0",
  "errorCode": "assistant_selector_missing"
}
```

No uploader is implemented here. A future reporting endpoint may receive only
those four validated fields. Prompts, responses, page text, raw DOM, cookies,
headers, user identifiers, and calibration fingerprints are excluded.

The durable publication workflow should remain:

1. Aggregate bounded drift counters and deduplicate/rate-limit reports.
2. Inspect the provider in a controlled browser session.
3. generate a candidate JSON manifest.
4. Run fixture, built-in-provider, malformed-input, and rollback tests.
5. Review and commit the manifest to Git.
6. Publish the reviewed JSON through an API/CDN.

Redis may support counters, rate limits, queues, or temporary caches, but Git
remains the durable reviewed source.
