# Browser automation migration

The extension remains the TETHER product boundary. External Playwright is a preserved development
fallback; the target runtime uses Puppeteer's experimental Chrome-extension transport over the
existing `chrome.debugger` permission.

```text
Codex or web-chat orchestrator
  <-> local TETHER adapter
  <-> extension service-worker WebSocket
  <-> Puppeteer ExtensionTransport per explicitly activated tab
  <-> existing logged-in browser-chat page
```

Puppeteer owns page-level mechanics only: locating the composer, writing, resolving the actionable
send control after the write, clicking once, observing a new assistant turn, and extracting stable
text. Existing extension authorities remain unchanged:

- `extensionInstanceId` and `browserSessionId` persistence;
- explicit activation and exactly-one-active-session selection;
- tab ownership and navigation cancellation;
- adapter rendezvous, correlation, idempotency, and reconnect protection;
- side-panel UI and future browser-to-browser routing;
- calibration and content-script behavior as a preserved fallback until parity is accepted.

Each activated tab needs its own Puppeteer connection because extension transport exposes one tab.
In-memory Puppeteer objects are never persisted. After service-worker termination or debugger
detachment, reconstruct the connection from the stored active session and real Chrome `tabId`.

The migration is successful only when the extension path proves the same bootstrap, ordinary text,
deferred schema, tool call, tool-result continuation, repeated-turn, cancellation, and stale-socket
behaviors as the preserved Playwright checkpoint.

## Implemented extension transport

The service worker creates one reusable Puppeteer CDP connection per activated tab with
`ExtensionTransport.connectTab(tabId)`. TETHER still owns activation, stable session identity,
adapter rendezvous, cancellation, and cross-tab routing. Puppeteer owns only composer fill, Send
activation, and assistant observation.

The production bundle intentionally imports Puppeteer's narrow CDP connector instead of the public
`connect()` barrel. That barrel also references Node launchers, WebSocket transports, and WebDriver
BiDi; bundling it into Manifest V3 produced Node compatibility shims even though TETHER never used
those branches. `npm run build` now fails if those Node-only branches reappear.

Connections are released on tab deactivation, navigation, and closure. A stale disconnect event
cannot delete a newer connection for the same tab. Different tabs may operate concurrently, while
each individual tab remains single-threaded.
