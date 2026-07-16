# Working browser-automation checkpoint

This checkpoint preserves the last verified external Playwright implementation before browser
automation moves into the TETHER extension. It is a fallback and a protocol oracle, not the final
product architecture.

## Verified architecture

```text
unchanged Codex Responses client
  <-> local TETHER Responses adapter
  <-> Playwright persistent Brave context
  <-> one persistent browser-chat conversation
```

The adapter launches Brave with `playwright-core`, a dedicated persistent profile, and the built
TETHER extension. The browser controller installs one protocol bootstrap per live page, sends only
the compact current turn afterward, waits for a new stable assistant response, validates its
correlated TETHER envelope, and translates it into the Responses events Codex already understands.

The verified checkpoint supports ordinary assistant text, deferred exact tool-schema delivery, one
tool call, Codex tool-result continuation, and repeated turns in one persistent conversation.

## Reproduction

```powershell
cd "C:\Users\Megh Mayur\OneDrive\Desktop\REACT\rerender"
npm test
npm run build
npm run verify:content-script

cd "C:\Users\Megh Mayur\OneDrive\Desktop\TETHER\tether-adapter"
npm test
$env:TETHER_BROWSER_ENGINE = 'playwright'
npm start
```

The normal Codex provider still connects to `ws://127.0.0.1:8766/v1/responses`. The external
Playwright controller is selected only by `TETHER_BROWSER_ENGINE=playwright`.

## Lessons that must survive the migration

1. Do not intercept or replace `ModelClientSession::stream`. Codex must retain its existing
   serialization, Responses parser, agent loop, approvals, sandbox, tools, continuation, history,
   and TUI.
2. Insertion and submission are separate asynchronous phases. Writing text does not prove the
   framework has made the send control actionable. Resolve or wait after the write, then click once.
3. DOM node count is not a reliable turn identity. React can reuse an assistant container. Compare
   both the baseline count and baseline text, and require a new stable snapshot.
4. The submitted prompt contains protocol examples. Extraction must observe the assistant region
   only and correlate the returned `requestId`; never parse the whole conversation as one blob.
5. A long Codex request cannot be pasted wholesale into consumer chat. Keep Codex runtime state
   local, send only the current user/tool-result delta, advertise tool names compactly, and deliver
   an exact schema only after a correlated deferred request.
6. Install the protocol bootstrap once per live browser conversation. Repeating it wastes composer
   capacity and makes the model less reliable.
7. Consumer models can occasionally answer an ordinary turn as plain text. Plain non-JSON text is
   unambiguous assistant output, but JSON-looking output must stay on the strict validation path so
   malformed or invented tool calls cannot be accepted.
8. Browser automation requires persistent login state and a persistent conversation. Starting a
   fresh automated profile can look like a transport failure when it is actually logged out.
9. Service-worker globals are disposable. Persist identities and session snapshots, then recreate
   live browser/CDP objects after restart.
10. Exactly-one-active-session selection remains explicit. Never silently choose the newest tab or
    steal a route from another activated session.

## Verification at checkpoint creation

- Adapter: 44 tests passed.
- Extension: 124 tests passed.
- Extension changed-file ESLint: passed.
- Extension production build: passed.
- `dist/content-script.js` standalone verification: passed.
- Full extension lint still has four unrelated pre-existing UI errors in `Button.jsx`,
  `FerroFluid.jsx`, and the two `Silk.jsx` files.

## Migration target

Bundle the browser entry point of `puppeteer-core` into the Manifest V3 extension and connect to an
explicitly activated tab with `ExtensionTransport.connectTab(tabId)`. The extension remains the UI,
identity, persistence, networking, and cross-tab routing authority. Puppeteer replaces only the
fragile hand-written CDP/DOM automation. Keep this Playwright checkpoint runnable until extension
parity is proven.
