# TETHER extension architecture

This document records runtime boundaries that must survive beyond any one development chat.

## Current product path

```text
Codex CLI listener
  <-> one TETHER service-worker WebSocket
  <-> zero or more explicitly activated browser-chat tabs
  <-> each activated tab's isolated browser session
```

Granting site access, calibrating an origin, opening the side panel, and activating a tab are different
events. The toolbar may manually open the panel on any tab. Unsupported pages show an
unsupported state. A calibrated origin makes a tab eligible, but only the explicit
`Activate TETHER in this tab` action creates a browser session.

An activated tab retains its own session while it is in the background. Its persistent panel
is hidden on inactive or unsupported tabs and restored when the user returns. Opening TETHER
elsewhere never steals or mutates that session.

## Identity and ownership invariants

- Chrome `tabId` and message `sender.tab.id` are runtime authority; a page-provided ID is not.
- One installed extension profile has one service worker and potentially many content scripts.
- Every activated tab has a distinct `browserSessionId`, including tabs with the same provider
  and conversation URL.
- Ordinary HTTP(S) origins are calibratable without a named provider adapter. Adapters may
  add a display name or conversation parser, but never decide basic eligibility.
- A command for one tab must never be accepted from or routed to another tab.
- Only one calibration or later browser operation may own a target tab at a time.
- Tab close, cross-origin navigation, panel close, cancellation, timeout, or extension reload
  must release the operation and page overlay.
- WebSocket request IDs correlate protocol turns; they are not browser-session identities.

## Storage ownership

- `chrome.storage.local`: durable provider calibration profiles keyed by origin.
- `chrome.storage.local`: bounded last-known-good declarative provider adapter
  versions keyed by origin (`providerAdapterCacheV1`).
- `chrome.storage.session`: explicitly activated browser-session records and active-operation
  recovery metadata.
- JavaScript globals: live objects only, including the WebSocket and DOM references.
- Never persist a WebSocket or present a stored connection snapshot as live truth.

Calibration validity is determined by resolving and validating its fingerprints, not merely
by its age. Conversation/session storage is deliberately deferred until real Codex request,
retry, cancellation, history, and continuation behavior has been captured.

Panel projection keeps four authorities separate:

```text
Chrome origin permission -> may the content script run?
calibrationProfiles[origin] -> what controls were saved?
live fingerprint validation -> do those controls resolve on this page now?
browserSessions[sessionId] -> was this tab explicitly activated?
```

`calibrationProfiles` retains the Checkpoint 4 `{ version, origin, composer, send }` shape.
New profiles also record their real creation time. No legacy calibration key is fabricated:
Git history shows the same `calibrationProfiles` key throughout the implemented calibration
checkpoint. Existing records are consumed as-is and validated live.

## Service-worker recovery

Chrome 116+ resets the worker idle timer when WebSocket messages are exchanged. TETHER's
bounded ping/pong cadence normally keeps a healthy connection active, but unexpected worker
termination must still be safe. Active calibration metadata is stored in `storage.session`.
On worker startup the coordinator asks the recorded tab's content script for its live state;
it resumes only if the tab and overlay agree, otherwise it fails and clears the record.

The minimal browser-session record is:

```text
schemaVersion, browserSessionId, tabId, windowId, providerId, origin,
conversationId, calibrationKey, status, createdAt, lastSeenAt
```

On worker startup, stored sessions are reconciled against live tabs. Tab closure and
unsupported/cross-provider navigation delete only the affected session. Stable same-provider
conversation navigation updates `conversationId` without replacing `browserSessionId`.
Legacy `tabAttachments` are deleted and are never promoted into activated sessions.

Inspect-style calibration is a correlated single-flight operation:

```text
requestId, tabId, origin, mode=replace, startedAt, stage
```

The tab comes from the side panel's document binding and is never re-queried globally after
resolution. Repeated starts for the same tab reuse the owned operation; another tab cannot
steal it. A previous origin profile remains in `calibrationProfiles` throughout selection and
is replaced only after both newly selected fingerprints validate. Cancellation, failure, or
navigation leaves the previous profile intact.

## Approved future two-chat mode (not implemented)

TETHER must eventually support communication between two different chat tabs in the same
browser profile. This will be tab-to-tab routing through the single service worker, not two
extension workers:

```text
content script in chat tab A
  <-> TETHER service-worker router
  <-> content script in chat tab B
```

That mode is approved product scope but intentionally not implemented yet. It will use
OTP-based pairing and must work across supported providers. Pairing offers, OTP generation,
attempt limits, route ownership/lifecycle, generalized owner types, and browser-to-browser
routing remain deferred.

The delivery order remains: prompt injection, three-message response calibration,
MutationObserver extraction, and a complete plain-text Codex round trip first; OTP pairing
comes after those foundations work. Exact route schemas must not be invented prematurely.

The original 64 KiB Checkpoint 2 WebSocket text guard is retired before real model payloads.
The current temporary transport safety bound is 16 MiB. This remains a defensive bound, not
a model-response limit; chunked protocol framing should replace single-frame payloads later.
