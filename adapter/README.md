# TETHER XposE adapter

The adapter exposes one explicitly activated browser conversation through an
authenticated, OpenAI-compatible localhost API. It accepts Responses and Chat
Completions requests, correlates them to the activated extension session, and
returns browser-extracted text or standard tool calls to the requesting client.

## Run

From the repository root:

```powershell
node .\bin\tether.js xpose
```

The server binds to `127.0.0.1:8766`. The command prints the base URL, model ID,
persistent local API key, and current browser-endpoint status.

Supported API routes:

- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`

The extension connects to `/tether/extension` over a paired loopback WebSocket.
Exactly one browser session must be activated in XposE mode.

See [the XposE guide](../docs/xpose.md) for client configuration, tool-calling
behavior, streaming, lifecycle errors, and the security contract.

## Test

```powershell
npm test
npm --prefix adapter test
```
