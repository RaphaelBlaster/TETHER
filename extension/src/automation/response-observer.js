/**
 * Baseline capture, streaming observation, stability completion.
 */

export function buildBaselineScript({
  userSelectors = [],
  assistantSelectors = [],
  response = null,
} = {}) {
  return `(() => {
    const userSelectors = ${JSON.stringify(userSelectors)};
    const assistantSelectors = ${JSON.stringify(assistantSelectors)};
    const response = ${JSON.stringify(response)};

    function root() {
      for (const selector of response?.rootSelectors || []) {
        try {
          const element = document.querySelector(selector);
          if (element) return element;
        } catch (_) {}
      }
      return document;
    }

    function count(sels) {
      for (const s of sels || []) {
        try {
          const n = root().querySelectorAll(s).length;
          if (n) return n;
        } catch (_) {}
      }
      return 0;
    }

    function texts(sels, limit = 50) {
      for (const s of sels || []) {
        try {
          const nodes = [...root().querySelectorAll(s)];
          if (nodes.length) {
            return nodes.slice(-limit).map((n, i) => {
              const text = (n.innerText || n.textContent || '').trim();
              return {
                i,
                text: text.slice(0, 500),
                suffix: text.slice(-500),
                len: text.length,
              };
            });
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
    const aSels = response?.turnSelectors?.length
      ? response.turnSelectors
      : assistantSelectors.length ? assistantSelectors : asstDefault;
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
  progressHints = [],
  response = null,
}) {
  return `(() => {
    const baseline = ${JSON.stringify(baseline || {})};
    const stopHints = ${JSON.stringify(stopHints)};
    const progressHints = ${JSON.stringify(progressHints)};
    const response = ${JSON.stringify(response)};

    function root() {
      for (const selector of response?.rootSelectors || []) {
        try {
          const element = document.querySelector(selector);
          if (element) return element;
        } catch (_) {}
      }
      return document;
    }

    function nodesFor(sels) {
      for (const s of sels || []) {
        try {
          const nodes = [...root().querySelectorAll(s)];
          if (nodes.length) return nodes;
        } catch (_) {}
      }
      return [];
    }

    function cleanText(el) {
      if (!el) return '';
      let regions = [el];
      for (const selector of response?.contentSelectors || []) {
        try {
          const matches = [...el.querySelectorAll(selector)];
          if (matches.length) {
            regions = matches;
            break;
          }
        } catch (_) {}
      }
      return regions.map((region) => {
        const clone = region.cloneNode(true);
        const exclusions = [
          'button', 'nav', 'svg', '[data-testid*="copy"]', '[aria-label*="Copy"]',
          '[aria-label*="Good"]', '[aria-label*="Bad"]', '[class*="feedback"]',
          ...(response?.excludeSelectors || []),
        ];
        for (const selector of exclusions) {
          try { clone.querySelectorAll(selector).forEach((n) => n.remove()); } catch (_) {}
        }
        return (clone.innerText || clone.textContent || '').replace(/\\u00a0/g, ' ').trim();
      }).filter(Boolean).join('\\n').trim();
    }

    function any(sels) {
      for (const s of sels || []) {
        try {
          const elements = [...document.querySelectorAll(s)];
          if (elements.some((element) => {
            if (typeof element.getClientRects !== 'function') return true;
            if (element.getClientRects().length === 0) return false;
            const style = globalThis.getComputedStyle?.(element);
            return !style ||
              (style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity) !== 0);
          })) return true;
        } catch (_) {}
      }
      return false;
    }

    function matchesSnapshot(text, snapshot) {
      if (!snapshot || text.length !== snapshot.len) return false;
      if (text.slice(0, 500) !== (snapshot.text || '')) return false;
      return snapshot.suffix === undefined ||
        text.slice(-500) === snapshot.suffix;
    }

    const asstSels = response?.turnSelectors?.length ? response.turnSelectors : baseline.assistantSelectors || [
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
      const prevLast = (baseline.assistantTexts || []).slice(-1)[0];
      if (text && !matchesSnapshot(text, prevLast)) target = last;
      else if (nodes.length > prevCount) target = last;
    }

    const text = target ? cleanText(target) : '';
    // Ignore if it equals a baseline assistant message exactly and count didn't grow.
    const isOld = (baseline.assistantTexts || []).some((snapshot) =>
      matchesSnapshot(text, snapshot)
    ) && nodes.length <= prevCount;

    const streaming = any(stopSels.concat(progressHints));

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
        const stable = now - stableSince >= stableMs;
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
