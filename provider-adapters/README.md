# TETHER provider adapters

This directory is the reviewed, durable source of truth for TETHER's declarative
browser provider adapters. The extension downloads published JSON over HTTPS;
it never runs Git and never downloads executable JavaScript.

## Publication

1. Create a provider-specific branch.
2. Change only the affected file under `sites/`.
3. Run `npm run registry:build` and the repository tests.
4. Open a pull request.
5. CI validates the schema, exact origin, selectors, fixtures, checksums and
   signature before publishing this directory to a static HTTPS origin.

`index.json` contains SHA-256 hashes for every provider manifest.
`index.sig.json` contains an Ed25519 signature when
`TETHER_REGISTRY_PRIVATE_KEY` is supplied by trusted CI. An unsigned index is
valid only for local development.

Redis is never a durable copy of these manifests. It may cache published bytes,
count drift failures, deduplicate reports, rate-limit callers and notify
maintenance workers.
