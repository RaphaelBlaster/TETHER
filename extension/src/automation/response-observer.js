/**
 * Baseline capture, streaming observation, stability completion.
 */

export function buildBaselineScript({
  userSelectors = [],
  assistantSelectors = [],
} = {}) {
  return `(() => {
    const userSelectors = ${JSON.stringify(userSelectors)};
    const assistantSelectors = ${JSON.stringify(assistantSelectors)};

    function count(sels) {
      for (const s of sels || []) {
        try {
          const n = document.querySelectorAll(s).length;
          if (n) return n;
        } catch (_) {}
      }
      return 0;
    }

    function texts(sels, limit = 50) {
      for (const s of sels || []) {
        try {
          const nodes = [...document.querySelectorAll(s)];
          if (nodes.length) {
            return nodes.slice(-limit).map((n, i) => ({
              i,
              text: (n.innerText || n.textContent || '').trim().slice(0, 500),
              len: (n.innerText || n.textContent || '').trim().length,
            }));
          }
        } catch (_) {}
      }
      return [];
    }

    function composerText() {
      const el =
        document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('form [contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea');
      if (!el) return '';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return String(el.value || '');
      return String(el.innerText || el.textContent || '');
    }

    const userDefault = ['[data-message-author-role="user"]', '[data-turn="user"]'];
    const asstDefault = ['[data-message-author-role="assistant"]', '[data-turn="assistant"]', 'model-response'];
    const uSels = userSelectors.length ? userSelectors : userDefault;
    const aSels = assistantSelectors.length ? assistantSelectors : asstDefault;
    const cText = composerText();

    return {
      url: location.href,
      userSelectors: uSels,
      assistantSelectors: aSels,
      userCount: count(uSels),
      assistantCount: count(aSels),
      userTexts: texts(uSels),
      assistantTexts: texts(aSels),
      composerText: cText,
      composerLength: cText.length,
      capturedAt: Date.now(),
    };
  })()`;
}

export function buildExtractAssistantScript({
  baseline,
  stopHints = [],
}) {
  return `(() => {
    const baseline = ${JSON.stringify(baseline || {})};
    const stopHints = ${JSON.stringify(stopHints)};

    function nodesFor(sels) {
      for (const s of sels || []) {
        try {
          const nodes = [...document.querySelectorAll(s)];
          if (nodes.length) return nodes;
        } catch (_) {}
      }
      return [];
    }

    function cleanText(el) {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll(
        'button, nav, svg, [data-testid*="copy"], [aria-label*="Copy"], [aria-label*="Good"], [aria-label*="Bad"], [class*="feedback"]'
      ).forEach((n) => n.remove());
      return (clone.innerText || clone.textContent || '').replace(/\\u00a0/g, ' ').trim();
    }

    function any(sels) {
      for (const s of sels || []) {
        try {
          if (document.querySelector(s)) return true;
        } catch (_) {}
      }
      return false;
    }

    const asstSels = baseline.assistantSelectors || [
      '[data-message-author-role="assistant"]',
      '[data-turn="assistant"]',
      'model-response',
      '.ds-markdown',
    ];
    const stopSels = stopHints.concat([
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      '.result-streaming',
      '[class*="result-streaming"]',
      '[data-is-streaming="true"]',
    ]);

    const nodes = nodesFor(asstSels);
    const prevCount = baseline.assistantCount || 0;
    // Prefer turns after baseline; if DOM recycled, use last node.
    let target = null;
    if (nodes.length > prevCount) {
      target = nodes[nodes.length - 1];
    } else if (nodes.length) {
      // Compare against baseline last text — if last changed, treat as new/streaming.
      const last = nodes[nodes.length - 1];
      const text = cleanText(last);
      const prevLast = (baseline.assistantTexts || []).slice(-1)[0]?.text || '';
      if (text && text !== prevLast) target = last;
      else if (nodes.length > prevCount) target = last;
    }

    const text = target ? cleanText(target) : '';
    // Ignore if it equals a baseline assistant message exactly and count didn't grow.
    const baselineSet = new Set((baseline.assistantTexts || []).map((t) => t.text));
    const isOld = baselineSet.has(text) && nodes.length <= prevCount;

    const streaming = any(stopSels);

    return {
      found: Boolean(target) && !isOld && text.length > 0,
      text: isOld ? '' : text,
      length: isOld ? 0 : text.length,
      assistantCount: nodes.length,
      prevAssistantCount: prevCount,
      streaming,
      isOld,
    };
  })()`;
}

/**
 * Incomplete JSON heuristic — do not complete while structure is open.
 */
export function looksLikeIncompleteJson(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  // Provider UIs may prepend a speaker label such as "Gemini said" before
  // streamed protocol JSON.  Examine the protocol object itself, not only
  // character zero, otherwise an unfinished tool_call can look stable and be
  // returned as ordinary assistant text.
  const protocolStart = t.search(/\{\s*"schemaVersion"\s*:/);
  const candidate = protocolStart >= 0 ? t.slice(protocolStart) : t;
  if (!(candidate.startsWith('{') || candidate.startsWith('['))) return false;

  let inString = false;
  let escape = false;
  let depth = 0;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
  }
  if (inString || escape) return true;
  if (depth > 0) return true;
  return false;
}

/**
 * Stability tracker for streamed text.
 */
export function createStabilityTracker({
  stableMs = 900,
  requireNonEmpty = true,
} = {}) {
  let lastText = '';
  let stableSince = 0;

  return {
    update(text, { streaming = false, now = Date.now() } = {}) {
      const t = text || '';
      if (requireNonEmpty && !t.trim()) {
        lastText = t;
        stableSince = 0;
        return { stable: false, text: t };
      }
      if (streaming) {
        lastText = t;
        stableSince = 0;
        return { stable: false, text: t };
      }
      if (t === lastText) {
        if (!stableSince) stableSince = now;
        const stable =
          now - stableSince >= stableMs && !looksLikeIncompleteJson(t);
        return { stable, text: t, stableForMs: now - stableSince };
      }
      lastText = t;
      stableSince = now;
      return { stable: false, text: t };
    },
    reset() {
      lastText = '';
      stableSince = 0;
    },
  };
}

/**
 * Pure helper: should we ignore this text as the user prompt?
 */
export function isUserPromptEcho(text, prompt) {
  if (!text || !prompt) return false;
  const a = text.replace(/\\s+/g, ' ').trim();
  const b = String(prompt).replace(/\\s+/g, ' ').trim();
  return a === b || a.includes(b) && a.length < b.length + 20;
}
