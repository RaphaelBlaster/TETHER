# TETHER Responses adapter protocol spike

This provisional adapter proves that unmodified Codex can use its existing Responses WebSocket
transport and that the TETHER extension can rendezvous with it as a second outbound WebSocket
client. Checkpoint 8 routes plain-text Codex turns through the persistent calibrated browser
conversation. It does not implement tool calls, authentication, or final packaging.

## Run

```powershell
npm test
npm start
```

The server binds only to `127.0.0.1` and defaults to port `8766`:

- `/v1/responses` accepts the existing Codex Responses WebSocket client.
- `/tether/extension` accepts the extension service worker.
- `POST /tether/dev/test` sends the Checkpoint 8C development-only test request.

Exact Codex requests are recorded in `captures/requests.ndjson`.

The extension registers with a full session snapshot:

```json
{
  "protocol": "tether-extension",
  "version": 1,
  "type": "hello",
  "extensionInstanceId": "...",
  "sessions": [
    {
      "browserSessionId": "...",
      "tabId": 123,
      "origin": "https://chatgpt.com",
      "providerId": "chatgpt",
      "conversationId": "..."
    }
  ]
}
```

Later full snapshots use `type: "sessions_changed"`. The development test uses
`test_request`, `test_completed`, and `test_error`, correlated by extension instance, browser
session, and request ID. Exactly one active browser session is required.

For a real turn the adapter sends:

```json
{
  "protocol": "tether-extension",
  "version": 1,
  "type": "browser_request",
  "requestId": "...",
  "browserSessionId": "...",
  "payload": {
    "prompt": "...",
    "installBootstrap": true
  }
}
```

The extension injects that prompt through the existing extraction pipeline and returns its raw
result as `browser_completed.payload.text`, or returns `browser_error.error` with bounded `code`
and `message` strings. The adapter accepts either browser-produced JSON object:

```json
{
  "schemaVersion": 1,
  "type": "assistant_text",
  "requestId": "...",
  "content": "..."
}
```

```json
{
  "schemaVersion": 1,
  "type": "tool_call",
  "requestId": "...",
  "callId": "...",
  "name": "shell_command",
  "arguments": {
    "command": "Get-Date"
  }
}
```

Extra keys, surrounding prose, markdown fences, empty content, and a mismatched request ID are
rejected. Tool names must have been offered by the current Codex request. The bootstrap version is
recorded per extension instance and browser conversation in `state/conversations.json`; later turns
contain only the current Codex input or function-call-output delta. The adapter translates a
`tool_call` into the normal Responses function-call item, allowing Codex to execute it through its
unchanged approval, sandbox, and tool machinery.

Provisional Codex provider configuration:

```toml
model_provider = "tether"

[model_providers.tether]
name = "TETHER local adapter"
base_url = "http://127.0.0.1:8766/v1"
wire_api = "responses"
supports_websockets = true
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
```

HTTP Responses fallback and `/v1/models` remain intentionally unsupported. If the WebSocket path
fails, the resulting error must remain visible rather than silently testing a different transport.
