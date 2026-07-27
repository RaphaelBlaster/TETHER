const TOPICS = Object.freeze({
  'response-envelope': [
    'For a normal final answer return ordinary plain text without a JSON envelope.',
    'For a protocol_help_request, tool_schema_request, or tool_call, return exactly one minified JSON object and no prose or markdown.',
    'In a JSON control message, copy the current command requestId exactly and use schemaVersion 1.',
    'A tool_schema_request contains exactly one offered tool name and its optional namespace.',
    'A tool_call contains a unique callId, the exact delivered tool name and optional namespace, and an arguments object matching the delivered schema.',
  ].join(' '),
  'deferred-tools': [
    'toolCatalog contains names only and does not authorize a tool_call.',
    'When a listed tool is required, request exactly one schema with tool_schema_request.',
    'After tether_tool_schema delivers that definition, return a matching tool_call if the tool is still required.',
    'If tether_tool_unavailable rejects a requested tool, choose an offered alternative when one can perform the work.',
    'If the missing capability genuinely requires installing or downloading software, ask the user for explicit permission in ordinary plain text and identify what would be installed and its source.',
    'Never install or download software merely because a model invented an unavailable tool.',
    'Never invent tools or claim execution before Codex returns a tool result.',
  ].join(' '),
  'tool-results': [
    'A function_call_output, custom_tool_call_output, or computer_call_output in turn.input is the result of the earlier tool call.',
    'Codex sends this continuation automatically; another user message is not required.',
    'Use that result to continue the same original objective.',
    'Do not return a final answer merely because one tool call completed. If the objective is incomplete, request the next required tool.',
    'Return a final answer only when the objective is complete or progress genuinely requires missing user input.',
    'Do not repeat the same tool call blindly, and do not claim success when the result reports failure.',
  ].join(' '),
  'windows-json': [
    'JSON-escape every output string.',
    'Each Windows path backslash must appear as two backslashes in JSON.',
    'Prefer single quotes around a PowerShell LiteralPath inside the JSON command string so path quoting does not terminate the JSON string.',
    'Escape embedded double quotes and newlines.',
  ].join(' '),
})

export const PROTOCOL_HELP_TOPICS = Object.freeze(Object.keys(TOPICS))

export function selectProtocolHelp(topics) {
  return topics.map((name) => {
    if (!Object.hasOwn(TOPICS, name)) {
      throw Object.assign(new Error(`Protocol help topic ${name} is unavailable`), {
        code: 'unavailable_protocol_help',
      })
    }
    return { name, content: TOPICS[name] }
  })
}
