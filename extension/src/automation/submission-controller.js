/**
 * Send control click (exactly once) + submission verification scripts.
 */

export function buildClickSendScript({ sendFp, sendSelector }) {
  return `(() => {
    const sendFp = ${JSON.stringify(sendFp)};
    const sendSelector = ${JSON.stringify(sendSelector)};

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      if (st.pointerEvents === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    function findSend() {
      if (sendSelector) {
        try {
          const el = document.querySelector(sendSelector);
          if (el) return el;
        } catch (_) {}
      }
      if (sendFp?.id) {
        const el = document.getElementById(sendFp.id);
        if (el) return el;
      }
      const sels = [
        'button#composer-submit-button',
        '#composer-submit-button',
        'button[aria-label="Send prompt"]',
        'button[data-testid="send-button"]',
        'button[type="submit"]',
        'button[aria-label*="Send" i]',
      ];
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el && (!sendFp || matchFp(el, sendFp))) return el;
        } catch (_) {}
      }
      return null;
    }

    const el = findSend();
    if (!el) {
      return { ok: false, code: 'send_not_found', message: 'Send control not found', clickable: false };
    }

    const r = el.getBoundingClientRect();
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
    const st = window.getComputedStyle(el);

    if (!el.isConnected || !isVisible(el) || disabled || st.pointerEvents === 'none' || r.width < 1 || r.height < 1) {
      return {
        ok: false,
        code: 'send_not_actionable',
        message: 'Send control is not actionable',
        clickable: false,
        diagnostics: {
          connected: el.isConnected,
          visible: isVisible(el),
          disabled,
          pointerEvents: st.pointerEvents,
          width: r.width,
          height: r.height,
        },
      };
    }

    // The caller dispatches one real CDP pointer sequence at these bounds.
    // Calling a synthetic DOM click here is not reliable for controlled composers.
    return {
      ok: true,
      clickable: true,
      clickCount: 1,
      centerX: r.left + r.width / 2,
      centerY: r.top + r.height / 2,
    };
  })()`;
}

export function buildSubmissionEvidenceScript({
  baseline,
  promptPreview,
  stopHints = [],
}) {
  return `(() => {
    const baseline = ${JSON.stringify(baseline || {})};
    const promptPreview = ${JSON.stringify(promptPreview || '')};
    const stopHints = ${JSON.stringify(stopHints)};

    function count(sels) {
      for (const s of sels || []) {
        try {
          const n = document.querySelectorAll(s).length;
          if (n) return n;
        } catch (_) {}
      }
      return 0;
    }

    function textOf(selList) {
      for (const s of selList || []) {
        try {
          const nodes = document.querySelectorAll(s);
          if (nodes.length) {
            const last = nodes[nodes.length - 1];
            return (last.innerText || last.textContent || '').trim().slice(0, 200);
          }
        } catch (_) {}
      }
      return '';
    }

    function any(sels) {
      for (const s of sels || []) {
        try {
          if (document.querySelector(s)) return true;
        } catch (_) {}
      }
      return false;
    }

    function composerValue() {
      const el =
        document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea');
      if (!el) return '';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return String(el.value || '');
      return String(el.innerText || el.textContent || '');
    }

    const userSels = baseline.userSelectors || ['[data-message-author-role="user"]', '[data-turn="user"]'];
    const asstSels = baseline.assistantSelectors || ['[data-message-author-role="assistant"]', '[data-turn="assistant"]'];
    const stopSels = stopHints.concat([
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      '.result-streaming',
      '[data-is-streaming="true"]',
    ]);

    const userCount = count(userSels);
    const asstCount = count(asstSels);
    const composer = composerValue();
    const stopVisible = any(stopSels);
    const lastUser = textOf(userSels);

    const evidence = {
      userCount,
      asstCount,
      prevUserCount: baseline.userCount || 0,
      prevAsstCount: baseline.assistantCount || 0,
      composerLength: composer.length,
      prevComposerLength: baseline.composerLength || 0,
      stopVisible,
      lastUserPreview: lastUser.slice(0, 80),
      promptSeenInUser:
        Boolean(promptPreview) &&
        lastUser.replace(/\\s+/g, ' ').includes(String(promptPreview).replace(/\\s+/g, ' ').slice(0, 80)),
      composerCleared:
        (baseline.composerLength || 0) > 0 && composer.trim().length === 0,
      composerChanged: composer !== (baseline.composerText || ''),
      userIncreased: userCount > (baseline.userCount || 0),
      asstIncreased: asstCount > (baseline.assistantCount || 0),
      url: location.href,
      prevUrl: baseline.url || '',
    };

    const score =
      (evidence.userIncreased ? 3 : 0) +
      (evidence.promptSeenInUser ? 3 : 0) +
      (evidence.composerCleared ? 2 : 0) +
      (evidence.composerChanged ? 1 : 0) +
      (evidence.stopVisible ? 2 : 0) +
      (evidence.asstIncreased ? 2 : 0) +
      (evidence.url !== evidence.prevUrl ? 1 : 0);

    return {
      submitted: score >= 3,
      score,
      evidence,
    };
  })()`;
}

/**
 * Pure: decide if evidence is enough (for tests).
 */
export function isSubmissionObserved(evidence, { minScore = 3 } = {}) {
  if (!evidence) return false;
  if (typeof evidence.score === 'number') return evidence.score >= minScore;
  let score = 0;
  if (evidence.userIncreased) score += 3;
  if (evidence.promptSeenInUser) score += 3;
  if (evidence.composerCleared) score += 2;
  if (evidence.composerChanged) score += 1;
  if (evidence.stopVisible) score += 2;
  if (evidence.asstIncreased) score += 2;
  if (evidence.url && evidence.prevUrl && evidence.url !== evidence.prevUrl) score += 1;
  return score >= minScore;
}

/**
 * Track single-click invariant for tests.
 */
export function createClickOnceGuard() {
  let clicks = 0;
  return {
    click() {
      clicks += 1;
      if (clicks > 1) {
        const err = new Error('Send clicked more than once');
        err.code = 'multiple_clicks';
        throw err;
      }
      return clicks;
    },
    get count() {
      return clicks;
    },
  };
}
