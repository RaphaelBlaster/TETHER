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

// ../../../../2026-07-28/continue-tether-development-carefully-worktree-c/work/omniroute-current/open-sse/translator/deepseekWebTools.ts
function serializeDeepSeekToolPrompt(tools) {
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
    "You can call tools. To call a tool, output ONLY this exact block (no markdown fence):",
    '<tool>{"name": "<tool_name>", "arguments": { ... }}</tool>',
    "Rules:",
    "- Use exactly <tool>...</tool>. Do NOT use <tool:name>, <tool_call>, <name>, <parameter>, id=/name= attributes, or code fences.",
    '- "name" must be one of the tools below; "arguments" must be a JSON object.',
    "- When a tool is needed, emit the <tool> block instead of only describing the plan.",
    "- Emit one <tool> block per call; you may put several blocks back to back.",
    "- If no tool is needed, just answer normally without any <tool> block.",
    "",
    "Available tools:",
    ...lines
  ].join("\n");
}
function extractText(content) {
  if (Array.isArray(content)) {
    return content.filter((item) => item?.type === "text").map((item) => item?.text ?? "").join("\n");
  }
  return content == null ? "" : String(content);
}
function buildToolConversationPrompt(messages, toolSystemPrompt) {
  const systemParts = [];
  if (toolSystemPrompt) systemParts.push(toolSystemPrompt);
  const lines = [];
  const callNameById = /* @__PURE__ */ new Map();
  let sawToolActivity = false;
  for (const m of messages) {
    if (m.role === "system") {
      const t = extractText(m.content).trim();
      if (t) systemParts.push(t);
    } else if (m.role === "user") {
      const t = extractText(m.content).trim();
      if (t) lines.push(`User: ${t}`);
    } else if (m.role === "assistant") {
      const t = extractText(m.content).trim();
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      const parts2 = [];
      if (t) parts2.push(t);
      for (const c of calls) {
        const name = typeof c?.function?.name === "string" ? c.function.name : "";
        const rawArgs = c?.function?.arguments;
        const args = typeof rawArgs === "string" && rawArgs ? rawArgs : JSON.stringify(rawArgs ?? {});
        if (c?.id) callNameById.set(c.id, name);
        parts2.push(`<tool>{"name": ${JSON.stringify(name)}, "arguments": ${args}}</tool>`);
        sawToolActivity = true;
      }
      if (parts2.length) lines.push(`Assistant: ${parts2.join("\n")}`);
    } else if (m.role === "tool") {
      const t = extractText(m.content).trim();
      const name = m.tool_call_id && callNameById.get(m.tool_call_id) || m.name || "tool";
      lines.push(`Tool result (${name}): ${t || "(no output)"}`);
      sawToolActivity = true;
    }
  }
  const parts = [];
  if (systemParts.length) parts.push(systemParts.join("\n\n"));
  if (lines.length) parts.push(lines.join("\n\n"));
  if (sawToolActivity) {
    parts.push(
      "Continue the task using the tool results above. Do NOT repeat tool calls that already succeeded; perform the next step or give the final answer."
    );
  }
  return parts.join("\n\n").replace(/!\[.*?\]\(.*?\)/g, "");
}
var TAG_TOKEN_RE = /<(\/?)(?:tool_call|tool)(:[A-Za-z0-9_.+-]+)?((?:\s[^>]*)?)\/?>/g;
function tokenizeToolTags(text) {
  const tokens = [];
  let m;
  TAG_TOKEN_RE.lastIndex = 0;
  while ((m = TAG_TOKEN_RE.exec(text)) !== null) {
    tokens.push({
      start: m.index,
      end: TAG_TOKEN_RE.lastIndex,
      closing: m[1] === "/",
      suffix: m[2] ? m[2].slice(1) : "",
      attrs: m[3] || ""
    });
  }
  return tokens;
}
function pairToolBlocks(tokens, textLen) {
  const blocks = [];
  const stack = [];
  for (const tok of tokens) {
    if (!tok.closing) {
      stack.push(tok);
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    blocks.push({ open, close: tok, innerStart: open.end, innerEnd: tok.start });
  }
  for (const open of stack) {
    const synthetic = {
      start: textLen,
      end: textLen,
      closing: true,
      suffix: "",
      attrs: ""
    };
    blocks.push({ open, close: synthetic, innerStart: open.end, innerEnd: textLen });
  }
  return blocks;
}
function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("|')`);
  const m = re.exec(attrs);
  if (!m) return null;
  const quote = m[1];
  let j = m.index + m[0].length;
  let out = "";
  while (j < attrs.length) {
    const ch = attrs[j];
    if (ch === "\\") {
      out += attrs[j + 1] ?? "";
      j += 2;
      continue;
    }
    if (ch === quote) break;
    out += ch;
    j += 1;
  }
  return out;
}
function getXmlChild(inner, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(inner);
  return m ? m[1].trim() : null;
}
var PARAM_TAG_RE = /<parameter\b([^>]*?)\/?>(?:((?:(?!<parameter\b)[\s\S])*?)<\/parameter>)?/gi;
function buildArgsFromParameters(inner) {
  const out = {};
  let found = false;
  let m;
  PARAM_TAG_RE.lastIndex = 0;
  while ((m = PARAM_TAG_RE.exec(inner)) !== null) {
    const attrs = m[1] || "";
    const body = m[2];
    const name = getAttr(attrs, "name");
    if (!name) continue;
    const value = getAttr(attrs, "content") ?? (typeof body === "string" ? body.trim() : "");
    out[name] = value;
    found = true;
  }
  return found ? out : null;
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function buildSchemaParamMap(requestedTools) {
  const map = /* @__PURE__ */ new Map();
  if (!Array.isArray(requestedTools)) return map;
  for (const tool of requestedTools) {
    const fn = tool?.function;
    if (!fn?.name) continue;
    const params = fn.parameters;
    const props = params?.properties;
    if (props && typeof props === "object" && !Array.isArray(props)) {
      map.set(fn.name, new Set(Object.keys(props)));
    } else {
      map.set(fn.name, /* @__PURE__ */ new Set());
    }
  }
  return map;
}
function extractCall(tagName, innerRaw, requested, schemaMap) {
  const inner = innerRaw.trim();
  const nameChild = getXmlChild(inner, "name");
  const argsChild = getXmlChild(inner, "arguments") ?? getXmlChild(inner, "parameters");
  const paramObj = argsChild ? null : buildArgsFromParameters(inner);
  const hasXmlChildren = !!nameChild || !!argsChild || !!paramObj;
  const json = hasXmlChildren ? null : parseLooseJsonObject(inner);
  const jsonName = json ? asString(json.name) ?? asString(json.type) : null;
  const childResolved = nameChild ? resolveRequestedToolName(nameChild, requested) : null;
  const jsonResolved = jsonName ? resolveRequestedToolName(jsonName, requested) : null;
  const tagResolved = tagName ? resolveRequestedToolName(tagName, requested) : null;
  let name = null;
  let nameFromTag = false;
  const pick = (val, fromTag) => {
    if (!name && val) {
      name = val;
      nameFromTag = fromTag;
    }
  };
  pick(childResolved, false);
  pick(jsonResolved, false);
  pick(tagResolved, true);
  pick(nameChild, false);
  pick(jsonName, false);
  pick(tagName, true);
  if (!name && !tagName && json) {
    const command = asString(json.command);
    const resolved = command ? resolveRequestedToolName(command, requested) : null;
    if (resolved) {
      name = resolved;
      nameFromTag = false;
    }
  }
  if (!name && paramObj && schemaMap && schemaMap.size > 0) {
    const extractedKeys = Object.keys(paramObj);
    if (extractedKeys.length > 0) {
      const candidates = [];
      for (const [toolName, schemaKeys] of schemaMap) {
        if (schemaKeys.size > 0 && extractedKeys.every((k) => schemaKeys.has(k))) {
          candidates.push(toolName);
        }
      }
      if (candidates.length === 1) {
        name = candidates[0];
        nameFromTag = false;
      }
    }
  }
  if (!name) return null;
  let argsValue;
  if (argsChild) {
    argsValue = parseLooseJsonObject(argsChild) ?? argsChild;
  } else if (paramObj) {
    argsValue = paramObj;
  } else if (json) {
    if (json.arguments !== void 0) argsValue = json.arguments;
    else if (json.params !== void 0) argsValue = json.params;
    else if (nameFromTag) {
      argsValue = json;
    } else {
      const { name: _n, type: _t, id: _i, command: _c, arguments: _a, params: _p, ...rest } = json;
      argsValue = rest;
    }
  } else {
    argsValue = {};
  }
  return { name, arguments: toArgumentsString(argsValue) };
}
function parseDeepSeekToolCalls(text, idSeed = "call", requestedTools) {
  if (typeof text !== "string" || text.length === 0) {
    return { content: text ?? "", toolCalls: null };
  }
  const tokens = tokenizeToolTags(text);
  if (tokens.length === 0) {
    return parseToolCallsFromText(text, idSeed, requestedTools);
  }
  const requested = getRequestedToolNames(requestedTools);
  const schemaMap = buildSchemaParamMap(requestedTools);
  const blocks = pairToolBlocks(tokens, text.length);
  const isLeaf = (b) => !blocks.some((o) => o !== b && o.open.start >= b.innerStart && o.close.end <= b.innerEnd);
  const toolCalls = [];
  const acceptedRanges = [];
  for (const block of blocks.filter(isLeaf).sort((a, b) => a.open.start - b.open.start)) {
    const tagName = block.open.suffix || getAttr(block.open.attrs, "name") || getAttr(block.open.attrs, "id") || "";
    const inner = text.slice(block.innerStart, block.innerEnd);
    const call = extractCall(tagName, inner, requested, schemaMap);
    if (!call) continue;
    toolCalls.push({
      id: `${idSeed}_${toolCalls.length}`,
      type: "function",
      function: { name: call.name, arguments: call.arguments }
    });
    acceptedRanges.push({ start: block.open.start, end: block.close.end });
  }
  if (toolCalls.length === 0) {
    return parseToolCallsFromText(text, idSeed, requestedTools);
  }
  const within = (tok) => acceptedRanges.some((r) => tok.start >= r.start && tok.end <= r.end);
  const ranges = [
    ...acceptedRanges,
    ...tokens.filter((t) => !within(t)).map((t) => ({ start: t.start, end: t.end }))
  ];
  return { content: stripRanges(text, ranges), toolCalls };
}
export {
  buildToolConversationPrompt,
  parseDeepSeekToolCalls,
  serializeDeepSeekToolPrompt
};
// Vendored from OmniRoute open-sse/translator/deepseekWebTools.ts at
// 85b9c1754e4191f36d0058829ff7b4db213359e7. MIT license; see THIRD_PARTY_NOTICES.md.
// Mechanically transpiled from TypeScript to Node 18 ESM with esbuild.
