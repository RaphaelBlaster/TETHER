// ../../../../2026-07-28/continue-tether-development-carefully-worktree-c/work/omniroute-current/open-sse/translator/webTools.ts
var TOOL_BLOCK_RE = /<tool>\s*([\s\S]*?)\s*<\/tool>/g;
var TOOL_CALL_TAG_RE = /<tool_call(?:\s+[^>]*)?\s*>\s*([\s\S]*?)\s*<\/tool_call>/g;
function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function getRequestedToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  const names = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tool of tools) {
    const record = toRecord(tool);
    const fn = toRecord(record?.function);
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push({ original: name, normalized: normalizeToolName(name) });
  }
  return names;
}
function normalizeToolName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    const temp = previous;
    previous = current;
    current = temp;
  }
  return previous[b.length];
}
function scoreToolName(emitted, requested) {
  if (emitted === requested.original) return 1;
  const normalized = normalizeToolName(emitted);
  if (!normalized || !requested.normalized) return 0;
  if (normalized === requested.normalized) return 0.98;
  const shorter = Math.min(normalized.length, requested.normalized.length);
  const longer = Math.max(normalized.length, requested.normalized.length);
  if (shorter >= 4) {
    if (normalized.includes(requested.normalized) || requested.normalized.includes(normalized)) {
      return 0.86 - (longer - shorter) / Math.max(longer, 1) / 4;
    }
  }
  const distance = levenshteinDistance(normalized, requested.normalized);
  const similarity = 1 - distance / Math.max(longer, 1);
  return similarity >= 0.72 ? similarity : 0;
}
function resolveRequestedToolName(emitted, requestedTools) {
  if (requestedTools.length === 0) return emitted;
  let best = null;
  let secondBest = 0;
  for (const requested of requestedTools) {
    const score = scoreToolName(emitted, requested);
    if (!best || score > best.score) {
      secondBest = best?.score ?? 0;
      best = { name: requested.original, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }
  if (!best || best.score < 0.72) return null;
  if (best.score < 0.98 && best.score - secondBest < 0.08) return null;
  return best.name;
}
function stripCodeFence(value) {
  return value.trim().replace(/^```(?:json|javascript|js|python)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
function convertSingleQuotedStrings(value) {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      result += ch === '"' && inSingle ? '\\"' : ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (inSingle) {
        result += '\\"';
      } else {
        inDouble = !inDouble;
        result += ch;
      }
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result += '"';
      continue;
    }
    result += ch;
  }
  return result;
}
function replacePythonLiterals(value) {
  let result = "";
  let inString = false;
  let escaped = false;
  let token = "";
  const flushToken = () => {
    if (token === "True") result += "true";
    else if (token === "False") result += "false";
    else if (token === "None") result += "null";
    else result += token;
    token = "";
  };
  for (const ch of value) {
    if (escaped) {
      if (token) flushToken();
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (token) flushToken();
      result += ch;
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      if (token) flushToken();
      inString = !inString;
      result += ch;
      continue;
    }
    if (!inString && /[A-Za-z]/.test(ch)) {
      token += ch;
      continue;
    }
    if (token) flushToken();
    result += ch;
  }
  if (token) flushToken();
  return result;
}
function normalizeLooseJson(value) {
  return replacePythonLiterals(convertSingleQuotedStrings(value)).replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3').replace(/,\s*([}\]])/g, "$1");
}
function parseLooseJsonObject(raw) {
  const trimmed = stripCodeFence(raw);
  for (const candidate of [trimmed, normalizeLooseJson(trimmed)]) {
    try {
      return toRecord(JSON.parse(candidate));
    } catch {
    }
  }
  return null;
}
function findBareJsonCandidates(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (depth === 0 && ch !== "{") {
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const raw = text.slice(start, i + 1);
        if (/[{,]\s*["']?(name|command)["']?\s*:/i.test(raw) && /[{,]\s*["']?arguments["']?\s*:/i.test(raw)) {
          candidates.push({ raw, start, end: i + 1, requireRequestedTool: true });
        }
        start = -1;
      }
    }
  }
  return candidates;
}
function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}
function stripRanges(text, ranges) {
  let content = text;
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const range of sorted) {
    const lineStart = content.lastIndexOf("\n", range.start - 1) + 1;
    const nextLineBreak = content.indexOf("\n", range.end);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
    const beforeOnLine = content.slice(lineStart, range.start);
    const afterOnLine = content.slice(range.end, lineEnd);
    const removeWholeLine = beforeOnLine.trim() === "" && afterOnLine.trim() === "";
    const start = removeWholeLine ? lineStart : range.start;
    const end = removeWholeLine && nextLineBreak !== -1 ? nextLineBreak + 1 : removeWholeLine ? lineEnd : range.end;
    content = `${content.slice(0, start)}${content.slice(end)}`;
  }
  return content.replace(/\n{3,}/g, "\n\n").trim();
}
function toArgumentsString(value) {
  if (value === void 0) return "{}";
  if (typeof value === "string") {
    const parsed = parseLooseJsonObject(value);
    return parsed ? JSON.stringify(parsed) : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}
function serializeToolsToPrompt(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  const lines = [];
  for (const t of tools) {
    const fn = t?.function;
    if (!fn?.name) continue;
    const desc = typeof fn.description === "string" && fn.description ? fn.description : "";
    let params = "";
    try {
      params = fn.parameters ? JSON.stringify(fn.parameters) : "";
    } catch {
      params = "";
    }
    lines.push(
      `- ${fn.name}${desc ? `: ${desc}` : ""}${params ? `
  parameters: ${params}` : ""}`
    );
  }
  if (lines.length === 0) return "";
  return [
    "You can call tools. To call a tool, reply with a single line containing a <tool> block",
    'with JSON: <tool>{"name": "<tool_name>", "arguments": { ... }}</tool>',
    "Only emit the <tool> block when you actually want to call a tool; otherwise answer normally.",
    "",
    "Available tools:",
    ...lines
  ].join("\n");
}
function parseToolCallsFromText(text, idSeed = "call", requestedTools) {
  const requestedToolNames = getRequestedToolNames(requestedTools);
  const canParseBareJson = requestedToolNames.length > 0;
  if (typeof text !== "string" || !text.includes("<tool>") && !text.includes("<tool_call") && !canParseBareJson) {
    return { content: text ?? "", toolCalls: null };
  }
  const candidates = [];
  const toolBlockRanges = [];
  let blockMatch;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((blockMatch = TOOL_BLOCK_RE.exec(text)) !== null) {
    const range = { start: blockMatch.index, end: TOOL_BLOCK_RE.lastIndex };
    toolBlockRanges.push(range);
    candidates.push({
      raw: blockMatch[1].trim(),
      start: range.start,
      end: range.end,
      requireRequestedTool: false
    });
  }
  TOOL_CALL_TAG_RE.lastIndex = 0;
  while ((blockMatch = TOOL_CALL_TAG_RE.exec(text)) !== null) {
    const range = { start: blockMatch.index, end: TOOL_CALL_TAG_RE.lastIndex };
    toolBlockRanges.push(range);
    candidates.push({
      raw: blockMatch[1].trim(),
      start: range.start,
      end: range.end,
      requireRequestedTool: false
    });
  }
  if (canParseBareJson) {
    for (const candidate of findBareJsonCandidates(text)) {
      if (!toolBlockRanges.some((range) => rangesOverlap(range, candidate))) {
        candidates.push(candidate);
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start);
  const toolCalls = [];
  const acceptedRanges = [];
  for (const candidate of candidates) {
    const parsed = parseLooseJsonObject(candidate.raw);
    const emittedName = parsed && typeof parsed.name === "string" ? parsed.name : parsed && typeof parsed.command === "string" ? parsed.command : null;
    if (!emittedName) continue;
    const name = resolveRequestedToolName(emittedName, requestedToolNames) || (candidate.requireRequestedTool ? null : emittedName);
    if (!name || candidate.requireRequestedTool && requestedToolNames.length === 0) continue;
    const args = toArgumentsString(parsed?.arguments);
    toolCalls.push({
      id: `${idSeed}_${toolCalls.length}`,
      type: "function",
      function: { name, arguments: args }
    });
    acceptedRanges.push({ start: candidate.start, end: candidate.end });
  }
  if (toolCalls.length === 0) {
    return { content: text, toolCalls: null };
  }
  const content = stripRanges(text, acceptedRanges);
  return { content, toolCalls };
}
function prepareToolMessages(bodyObj, messages) {
  const requestedTools = bodyObj.tools;
  const hasTools = Array.isArray(requestedTools) && requestedTools.length > 0;
  if (!hasTools) return { hasTools: false, requestedTools, effectiveMessages: messages };
  const toolPrompt = serializeToolsToPrompt(requestedTools);
  return {
    hasTools: true,
    requestedTools,
    effectiveMessages: [{ role: "system", content: toolPrompt }, ...messages]
  };
}
function buildToolAwareResult(rawContent, requestedTools, idSeed = "call") {
  const { content, toolCalls } = parseToolCallsFromText(
    rawContent,
    `${idSeed}-${Date.now()}`,
    requestedTools
  );
  return {
    content,
    toolCalls,
    finishReason: toolCalls ? "tool_calls" : "stop"
  };
}
export {
  buildToolAwareResult,
  getRequestedToolNames,
  parseLooseJsonObject,
  parseToolCallsFromText,
  prepareToolMessages,
  resolveRequestedToolName,
  serializeToolsToPrompt,
  stripRanges,
  toArgumentsString
};
// Vendored from OmniRoute open-sse/translator/webTools.ts at
// 85b9c1754e4191f36d0058829ff7b4db213359e7. MIT license; see THIRD_PARTY_NOTICES.md.
// Mechanically transpiled from TypeScript to Node 18 ESM with esbuild.
