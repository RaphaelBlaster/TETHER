# Checkpoint 4 debugging record

This log preserves failures encountered while turning the visual side panel into a real,
tab-scoped calibration extension.

## WebSocket connection appeared as an extension error

**Symptom:** Chrome recorded `ERR_CONNECTION_REFUSED` while the panel correctly displayed
retrying.

**Cause:** Chrome reports every failed WebSocket network attempt in extension diagnostics,
even when application reconnect logic handles it.

**Resolution:** Keep bounded exponential reconnect and accurate panel state. Do not treat the
expected network diagnostic as an uncaught JavaScript failure.

## Multiple Codex sessions could compete for port 8765

**Symptom:** the listener was originally owned by each `ModelClientState`.

**Cause:** model sessions are shorter-lived and can coexist; each could attempt to bind the
same loopback port.

**Resolution:** move the listener to Codex `ThreadManagerState`, which is shared by ordinary
threads/sessions for the process lifetime.

## Calibration could not access an ordinary chat page

**Symptom:** dynamic content-script injection failed with “Cannot access contents of the page.”

**Cause:** opening a side panel did not reliably produce an `activeTab` grant, especially after
reloading an unpacked extension while its old panel remained visible.

**Resolution:** request optional HTTP(S) host access in direct response to Start calibration.
The permission is explicit rather than silently broad.

## Clicking the composer selected a decorative wrapper

**Symptom:** a large toolbar wrapper was highlighted and could not be resolved uniquely.

**Cause:** `elementsFromPoint()` returns the deepest visual node, which is not necessarily the
semantic editor or button.

**Resolution:** normalize clicked descendants to a nearest semantic textbox/contenteditable or
button, require unique fingerprint re-resolution, and make ambiguity recoverable instead of
ending calibration.

## Calibration overlay survived panel closure

**Symptom:** the highlight and instruction pill remained after the user explicitly closed
TETHER.

**Cause:** the content script outlives the side-panel document and had no owner-lifetime signal.

**Resolution:** connect the panel to the service worker and cancel the matching active
calibration when the initiating panel is explicitly closed. A calibration-only watchdog also
removes the overlay when the extension itself is invalidated.

## Tab-specific panel did not open

**Symptom:** after global side-panel behavior was disabled, clicking the TETHER action opened
nothing.

**Cause:** the action handler awaited a combined startup promise containing independent setup
operations. One rejected or delayed operation prevented the tab enable/open path from running.

**Resolution:** issue the tab-specific `setOptions()` and `sidePanel.open()` calls directly in
the toolbar click callback, before any awaited work can consume Chrome's user gesture. Opening
the panel does not create a browser session.

## Switching tabs was mistaken for closing TETHER

**Symptom:** hiding a tab-specific panel by switching to another tab could cancel the active
operation.

**Cause:** a runtime Port disconnect was treated as proof of explicit closure, but Chrome may
unload or disconnect a tab-specific panel when it becomes hidden.

**Resolution:** bind the panel port to its tab. On disconnect, cancel only when that bound tab is
still active. If it is inactive, the panel is merely hidden and the content script, operation,
and recovery metadata remain active. Tab removal and navigation use separate authoritative
events.

## Service-worker state can disappear

**Symptom:** an unexpected worker restart could forget which page owns an active overlay.

**Cause:** MV3 global variables are not durable. Healthy 15-second WebSocket ping/pong normally
keeps Chrome 116+ workers alive, but crashes, reloads, disconnects, and browser shutdown still
exist.

**Resolution:** store only active-operation metadata in `chrome.storage.session`; on startup,
ask the recorded content script for its live stage and resume only if both sides agree. Durable
provider fingerprints remain in `chrome.storage.local`.

## Provider calibration was incorrectly treated as tab activation

**Symptom:** making a second ChatGPT tab eligible caused it to behave as though TETHER had
already attached there, conflating shared provider setup with per-tab intent.

**Cause:** automatic attachment used the presence of an origin-wide calibration profile as
proof that every matching tab should become a TETHER endpoint.

**Resolution:** keep provider profiles in `storage.local`, but require an explicit
`Activate TETHER in this tab` action before creating a distinct `browserSessionId` in
`storage.session`. Manual panel opening only displays eligibility. Legacy `tabAttachments` are
removed rather than migrated. Each activated tab remains isolated by `tabId` and
`sender.tab.id`, survives background tab switches, and is reconciled on worker restart,
navigation, and closure.

## A provider adapter became an accidental allowlist

**Symptom:** Gemini and unknown HTTPS chat sites appeared as unsupported even though the
Checkpoint 4 inspector was generic.

**Cause:** `detectProvider()` contained only ChatGPT, and its `null` result was used as the
site-eligibility decision. The panel also treated a stored version number as proof that the
saved controls were currently valid.

**Resolution:** classify browser-restricted URLs separately from ordinary HTTP(S) origins.
Request optional host access only for the user-selected origin. Keep provider adapters as
optional label/conversation-ID enhancements. Preserve `calibrationProfiles`, validate its
schema, then ask the content script to resolve both fingerprints against the live document.
Permission, calibration, validation, and per-tab activation now remain independent states.

## Calibration controls disappeared after a profile existed

**Symptom:** the inactive and active session screens offered no way to see, validate, or redo
calibration. The primary UI also exposed a shortened internal `browserSessionId`.

**Cause:** UI state was a mutually exclusive chain: calibration required, inactive, or active.
Once a profile object existed, activation replaced calibration in the information hierarchy.

**Resolution:** always project calibration status alongside tab activation. A valid profile
shows `Calibration ready`, validation and recalibration actions; invalid fingerprints show
`Calibration needs updating`. Raw session identifiers are removed from normal UI and limited
to internal state. A collapsed development-only diagnostics disclosure reports non-sensitive
profile and validation metadata.

## Dynamically injected content script briefly flashed and disappeared

**Symptom:** stored ChatGPT calibration reported `validation_failed`, neither fingerprint
resolved, and starting calibration on ChatGPT or an unrelated permitted site flashed for a
moment without showing the inspector overlay.

**Cause:** the background and content-script entries both imported
`profile-validation.js`. Vite extracted that shared module and emitted a top-level ES-module
`import` in `dist/content-script.js`. `chrome.scripting.executeScript()` executes listed files
as classic scripts, so parsing failed before the runtime listener, controller, or overlay could
be installed.

**Resolution:** keep background-only profile schema inspection in `profile-schema.js` and the
DOM validator in the content-script-only dependency graph. The production build now emits one
standalone classic-compatible `content-script.js`; `npm run verify:content-script` rejects any
future static or dynamic import. Fingerprint creation and resolution remain shared within the
content-script bundle rather than duplicated.

## Recalibration was not single-flight or panel-bound

**Symptom:** rapid clicks caused overlapping starting/failure projections, and calibration
could theoretically target the globally active tab rather than the tab owning the panel.

**Cause:** the UI disabled nothing until an asynchronous refresh; `starting` was first
published with `tabId: null`; and `CalibrationSession.start()` queried the active tab again.

**Resolution:** the panel generates one request ID and locks synchronously. The service worker
resolves its panel-bound tab once and passes that exact tab, origin, and request ID into the
session. The session publishes an owned `starting` operation immediately, coalesces same-tab
duplicates, rejects cross-tab theft, persists correlated recovery metadata, and validates both
sender tab and request ID for page updates. Existing profiles remain untouched until a complete
replacement profile is validated and atomically written.
