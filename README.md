<p align="center">
  <img src="docs/assets/tether-readme-hero.svg" width="100%" alt="TETHER — Keep the thread. Turn the browser chat already in front of you into a tab-bound local endpoint.">
</p>

<p align="center">
  <img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest_V3-171714?style=flat-square&logo=googlechrome&logoColor=F3EFE4&labelColor=171714&color=F05A2A">
  <img alt="Node.js 18 or newer" src="https://img.shields.io/badge/Node.js-18%2B-171714?style=flat-square&logo=nodedotjs&logoColor=F3EFE4&labelColor=171714&color=F05A2A">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-171714?style=flat-square&logo=react&logoColor=F3EFE4&labelColor=171714&color=F05A2A">
  <img alt="Tests passing" src="https://img.shields.io/badge/tests-246_passing-171714?style=flat-square&labelColor=171714&color=2F8F62">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#xpose-mode">XposE</a> ·
  <a href="#using-tether">Using TETHER</a> ·
  <a href="#development">Development</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

TETHER exposes a browser chat that is already open, authenticated, and carrying the context you care about through an OpenAI-compatible localhost API. The Manifest V3 extension binds the selected provider tab, exposes it through a side panel, and protects the page from accidental interaction while automation owns the route.

It is designed for a simple idea: **keep the conversation in the browser, but let a local client use it as an endpoint.**

## Why TETHER

| Capability | What it means |
| --- | --- |
| **Keep the thread** | Work with the provider conversation already open in your browser instead of starting from an empty API session. |
| **Tab-bound ownership** | Every endpoint belongs to one concrete browser tab and keeps a stable session identity. |
| **Interaction guard** | A translucent, themed overlay blocks accidental page input while TETHER is active and releases it on deactivation. |
| **Local bridge** | The adapter listens on `127.0.0.1:8766`; no separate adapter installation or manual startup is required. |
| **Provider aware** | ChatGPT, Gemini, and Claude have built-in recognition. Other HTTPS chat surfaces can be calibrated. |
| **CROSS and XposE** | Pair two provider tabs or expose one conversation through an authenticated localhost API. |

## Quick start

### 1. Requirements

- Node.js 18 or newer
- npm and Git
- Chrome, Brave, or another Chromium browser with side-panel support
- An authenticated browser session for the chat provider you want to use

### 2. Install TETHER

Install directly from the repository:

```powershell
npm install --global git+https://github.com/RaphaelBlaster/TETHER.git
```

If the repository is private, authenticate Git for GitHub before running the command.

### 3. Load the extension once

Ask the installed CLI for the exact extension directory:

```powershell
tether extension-path
```

On a standard Windows npm installation, the printed directory will look like this:

```text
C:\Users\<YOUR_WINDOWS_USERNAME>\AppData\Roaming\npm\node_modules\@raphaelblaster\tether-cli\extension\dist
```

If you cloned the repository instead of using the global package, load this directory:

```text
C:\Users\<YOUR_WINDOWS_USERNAME>\path\to\TETHER\extension\dist
```

Replace `<YOUR_WINDOWS_USERNAME>` and `path\to` with the folders on your computer. The final folder must be `extension\dist`, with `manifest.json` directly inside it. Do not select `extension`, `src`, or the repository root.

Then:

1. Open `chrome://extensions` or `brave://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Paste the full directory printed by `tether extension-path` into the folder picker, open it, and select the `dist` folder containing `manifest.json`.
5. Pin TETHER if you want one-click access to the side panel.

### 4. Start XposE

Start the authenticated local API:

```powershell
tether xpose
```

Keep this process running while a local OpenAI-compatible client uses the browser endpoint.

### 5. Activate a browser endpoint

1. Open ChatGPT, Gemini, Claude, or a calibrated HTTPS chat page.
2. Click the TETHER extension icon to open its side panel for that tab.
3. Confirm that **XposE online** is shown.
4. Select **XposE** for a single endpoint.
5. Choose **Activate as XposE endpoint**.

The active view turns orange, the endpoint becomes live, and the interaction guard appears on the owned page. Deactivate from the power control in the side panel to restore normal page interaction.

## How it works

```mermaid
flowchart LR
    A[OpenCode or another local client] <-- OpenAI-compatible HTTP or SSE --> B[Local TETHER XposE adapter<br/>127.0.0.1:8766]
    B <-- Extension protocol --> C[TETHER MV3 extension]
    C <-- Tab-bound automation --> D[Browser chat tab]
```

The adapter translates OpenAI-compatible requests into a bounded browser-turn protocol. The extension maintains tab identity, connection state, calibration profiles, and the page interaction guard. Browser automation runs only against the endpoint selected in the side panel.

### Runtime sequence

1. `tether xpose` starts the authenticated adapter on port `8766`.
2. The extension registers the explicitly activated XposE browser session.
3. A local client sends a Chat Completions or Responses request.
4. TETHER correlates the request to the selected browser conversation.
5. TETHER writes the prompt, submits it, waits for a stable response, and returns the correlated result to the client.

## Using TETHER

### CROSS mode

CROSS mode binds two tabs:

- **MASTER** receives the primary request.
- **SLAVE** receives the master response and produces the final relayed answer.

Assign one role to each active endpoint. Duplicate roles are rejected, and both tabs remain independently identified.

### XposE mode

XposE turns exactly one activated browser conversation into an authenticated,
OpenAI-compatible localhost API. It works with OpenCode and other clients that
accept a custom OpenAI-compatible provider.

Run:

```powershell
tether xpose
```

Next:

1. Open TETHER beside the authenticated browser conversation you want to use.
2. Select **XposE** under **Transport**.
3. Choose **Activate as XposE endpoint**.
4. Copy the base URL and model ID from the endpoint card.
5. Copy the API key from the `tether xpose` terminal.

The local API key is created once, stored at
`~/.tether/state/xpose-api-token`, and reused across restarts. Configure each
local client once; rotate the key only if it is exposed:

```powershell
tether xpose --rotate-key
```

If the extension is reinstalled or its identity changes, stop XposE and reset
only the trusted extension pairing:

```powershell
tether --reset
```

Then restart `tether xpose` and activate the extension endpoint. The reset
preserves the XposE API key and browser-conversation state.

#### Configure OpenCode

Create a custom OpenAI-compatible provider with these values:

| OpenCode field | Value |
| --- | --- |
| **Provider ID** | `tether` |
| **Display name** | `TETHER` |
| **Base URL** | `http://127.0.0.1:8766/v1` |
| **API key** | The persistent token printed by `tether xpose` |
| **Model ID** | `tether-browser` |
| **Model name** | `TETHER Browser` |
| **Headers** | Leave empty |

After saving the provider, select **TETHER Browser** and send a normal prompt.
The request travels from OpenCode to the local companion, through the paired
extension, and into the one XposE-owned browser tab.

#### Verify the endpoint directly

```powershell
$headers = @{ Authorization = "Bearer <TOKEN_FROM_TETHER_XPOSE>" }
$body = @{
  model = "tether-browser"
  messages = @(@{ role = "user"; content = "Reply with: XposE is ready." })
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8766/v1/chat/completions" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

XposE supports `GET /v1/models`, `POST /v1/responses`, and
`POST /v1/chat/completions`, including function tools and `stream: true`.
Because browser pages expose stable completed answers rather than provider
token deltas, streaming uses valid SSE framing after the browser answer
stabilizes; it does not simulate token-by-token timing. Disconnecting the
client cancels the correlated browser turn.

See [the complete XposE guide](docs/xpose.md) for request shapes, lifecycle
errors, streaming details, and the security contract.

### Theme and interaction guard

The side panel and protected-page card support light and dark themes. Theme changes propagate to active protected pages. While an endpoint is active, the guard blocks manual pointer, keyboard, touch, and wheel input so automation cannot be interrupted accidentally.

## Install from source

Use this path when developing TETHER itself:

```powershell
git clone https://github.com/RaphaelBlaster/TETHER.git
cd TETHER

npm install
npm --prefix extension install
npm run extension:build
npm install --global .
```

For development, the unpacked extension directory is:

```text
C:\Users\<YOUR_WINDOWS_USERNAME>\path\to\TETHER\extension\dist
```

Reload TETHER in the browser extension manager and refresh provider tabs after rebuilding the content script.

## Development

Run the complete JavaScript checks:

```powershell
npm test
npm run pack:check
npm --prefix extension run lint
npm --prefix extension test
npm run extension:build
```

The current extension suite covers tab lifecycle, session identity, calibration, injection, extraction, automation, side-panel persistence, connection recovery, and rapid repeated actions.

### Repository layout

| Path | Purpose |
| --- | --- |
| `bin/tether.js` | CLI entry point. |
| `lib/launcher.js` | Exposes the XposE command and packaged extension path. |
| `adapter/` | Local Responses adapter and browser-turn protocol. |
| `extension/src/` | React side panel, MV3 background worker, and content automation. |
| `extension/dist/` | Production extension loaded through **Load unpacked** and included in the npm package. |

## Security and privacy notes

- The adapter binds to loopback at `127.0.0.1:8766`.
- XposE also rejects non-loopback clients, requires its local bearer token,
  restricts accepted `Host` values, and does not grant browser CORS access.
- Host access is optional and requested per selected origin.
- Extension-owned storage is restricted to trusted extension contexts.
- The interaction guard blocks user input; it is not a security sandbox.
- Chrome displays a browser-owned **“TETHER started debugging this browser”** banner while debugger-based automation is attached. This is expected security UI and cannot be hidden by the extension.
- Prompts and responses still pass through the browser provider you selected and remain subject to that provider's terms and privacy policy.

## Troubleshooting

### “The folder name is not valid” when loading the extension

Do not paste a nonexistent or truncated path into the folder picker. Run `tether extension-path`, navigate to that directory, and select the folder containing `manifest.json`.

### Bridge offline

Start `tether xpose` in a terminal. If it remains offline, check whether another process is using port `8766`, then restart XposE and reopen the side panel.

### The side panel or protected card looks stale after an update

Reload TETHER from `chrome://extensions`, then refresh the provider tab once so Chrome injects the current content script.

### A provider page cannot activate

Grant access for the current origin. Built-in providers can activate directly; other HTTPS chat pages require calibration of the composer, send control, and response structure.

### The page is protected but XposE has closed

Return to the owned tab and use the side-panel power control to deactivate it. TETHER preserves tab ownership during short bridge interruptions so an unrelated tab cannot silently take over the session.

## Contributing

1. Create a focused branch.
2. Keep browser-session identity and tab ownership explicit.
3. Add or update tests for lifecycle or protocol changes.
4. Rebuild `extension/dist` when extension source changes.
5. Run the complete checks above before opening a pull request.

Avoid mixing visual redesigns with automation-protocol changes unless the behavior genuinely requires both; the UI should remain replaceable without weakening the working bridge.

## License

This repository does not currently include a license. Add a `LICENSE` file before public release or accepting outside redistribution. The repository owner should explicitly choose the intended terms rather than inheriting a license from a reference project.
