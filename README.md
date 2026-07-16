# TETHER Suite

Private source snapshot containing the three TETHER components:

- `codex-cli/` — Codex CLI source used by TETHER (`cca16a1087`)
- `adapter/` — local Responses/browser adapter (`178def6`)
- `extension/` — Chrome/Brave side-panel extension (`15165c5`)

## Adapter and CLI

```powershell
cd adapter
npm install
npm test
.\scripts\start-tether-cli.ps1
```

The launcher starts the adapter on `127.0.0.1:8766` and opens Codex with the
local TETHER Responses provider configuration.

## Extension

```powershell
cd extension
npm install
npm test
npm run build
```

Load the generated `extension/dist` directory as an unpacked extension from
`brave://extensions` or `chrome://extensions`.

This repository intentionally excludes dependency directories, build output,
runtime state, logs, and nested Git histories.
