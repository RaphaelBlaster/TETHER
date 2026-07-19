# TETHER browser extension

The TETHER extension is a React 19 + Vite Manifest V3 side panel. It binds a supported or calibrated browser-chat tab to the local TETHER adapter, maintains stable tab/session identity, and installs the interaction guard used during browser automation.

## Development

```powershell
npm install
npm run dev
```

Build the unpacked extension:

```powershell
npm run build
```

Load `dist/` from `chrome://extensions` or `brave://extensions` with Developer mode enabled.

## Checks

```powershell
npm run lint
npm test
npm run build
```

The production build creates the side panel, background service worker, self-contained content script, manifest, icons, and local font assets in `dist/`.

See the [project README](../README.md) for product setup, architecture, runtime behavior, and troubleshooting.
