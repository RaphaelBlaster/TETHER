/**
 * Composer / Send discovery scoring — pure helpers + page-side evaluation script.
 */

import {
  genericComposerSelectors,
  genericSubmitSelectors,
} from '../provider-registry.js';

const SEARCH_LIKE =
  /\b(search|filter|find|query|lookup|go to|jump to|ask anything about your chats)\b/i;

/**
 * Score a composer candidate (pure — used in tests and mirrored in-page).
 */
export function scoreComposerCandidate(c) {
  let score = 0;
  if (!c) return -Infinity;
  if (c.hidden || c.zeroSize || c.disabled) return -1000;
  if (c.inSidePanel) return -1000;
  if (c.searchLike) score -= 80;

  if (c.visible) score += 40;
  if (c.editable) score += 30;
  if (c.focusable) score += 10;
  if (c.providerHint) score += 100;
  if (c.calibrated) score += 120;

  // Prefer larger, bottom-ish chat composers.
  score += Math.min(30, (c.area || 0) / 4000);
  score += Math.min(25, (c.bottomProximity || 0) * 25);

  if (c.nearSend) score += 35;
  if (c.roleTextbox) score += 15;
  if (c.tag === 'TEXTAREA') score += 12;
  if (c.contentEditable) score += 10;

  const name = `${c.ariaLabel || ''} ${c.placeholder || ''} ${c.name || ''}`;
  if (/message|prompt|chat|ask|composer|talk/i.test(name)) score += 20;
  if (SEARCH_LIKE.test(name)) score -= 60;

  return score;
}

/**
 * Score a send/submit candidate.
 */
export function scoreSendCandidate(c) {
  let score = 0;
  if (!c) return -Infinity;
  if (c.hidden || c.zeroSize) return -1000;
  if (c.disabled || c.ariaDisabled) score -= 40;
  if (c.inSidePanel) return -1000;

  if (c.visible) score += 30;
  if (c.providerHint) score += 100;
  if (c.calibrated) score += 120;
  if (c.typeSubmit) score += 40;
  if (c.idSuggestsSend) score += 50;
  if (c.nameSuggestsSend) score += 45;
  if (c.nearComposer) score += 40;
  if (c.enabled) score += 25;

  // ChatGPT known evidence.
  if (c.id === 'composer-submit-button') score += 80;
  if (/^send prompt$/i.test(c.ariaLabel || '')) score += 70;

  return score;
}

export function pickBest(candidates, scorer, minScore = 0) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates || []) {
    const s = scorer(c);
    if (s > bestScore) {
      bestScore = s;
      best = { candidate: c, score: s };
    }
  }
  if (!best || best.score < minScore) return null;
  return best;
}

/**
 * Page-side discovery script. Returns serializable candidate descriptors + best picks.
 * Executed via CDP Runtime.evaluate — must be self-contained.
 */
export function buildDiscoveryScript({
  composerHints = [],
  submitHints = [],
  calibratedComposer = null,
  calibratedSend = null,
} = {}) {
  const payload = {
    composerHints,
    submitHints,
    genericComposer: genericComposerSelectors(),
    genericSubmit: genericSubmitSelectors(),
    calibratedComposer,
    calibratedSend,
  };

  // Stringified function body for evaluate.
  return `(() => {
    const cfg = ${JSON.stringify(payload)};
    const SEARCH_LIKE = ${SEARCH_LIKE.toString()};

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      if (st.pointerEvents === 'none') return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      return true;
    }

    function rectInfo(el) {
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, width: r.width, height: r.height,
        area: r.width * r.height,
        bottomProximity: Math.max(0, Math.min(1, 1 - (r.bottom / Math.max(innerHeight, 1)))),
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2,
      };
    }

    function inExtensionUi(el) {
      try {
        if (el.closest && el.closest('[data-tether-root]')) return true;
      } catch (_) {}
      return false;
    }

    function fingerprint(el) {
      if (!el) return null;
      return {
        tag: el.tagName,
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
        name: el.getAttribute('name') || '',
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
        testId: el.getAttribute('data-testid') || '',
        contentEditable: el.isContentEditable || el.getAttribute('contenteditable') === 'true',
      };
    }

    function matchesFingerprint(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      if (fp.tag && el.tagName === fp.tag && fp.className) {
        const cn = typeof el.className === 'string' ? el.className : '';
        if (cn && cn.includes(String(fp.className).split(' ')[0])) return true;
      }
      return false;
    }

    function unique(list) {
      return [...new Set(list.filter(Boolean))];
    }

    function queryAll(selectors) {
      const out = [];
      for (const s of selectors) {
        try {
          out.push(...document.querySelectorAll(s));
        } catch (_) {}
      }
      return unique(out);
    }

    function scoreComposer(c) {
      let score = 0;
      if (!c) return -Infinity;
      if (c.hidden || c.zeroSize || c.disabled) return -1000;
      if (c.inSidePanel) return -1000;
      if (c.searchLike) score -= 80;
      if (c.visible) score += 40;
      if (c.editable) score += 30;
      if (c.focusable) score += 10;
      if (c.providerHint) score += 100;
      if (c.calibrated) score += 120;
      score += Math.min(30, (c.area || 0) / 4000);
      score += Math.min(25, (c.bottomProximity || 0) * 25);
      if (c.nearSend) score += 35;
      if (c.roleTextbox) score += 15;
      if (c.tag === 'TEXTAREA') score += 12;
      if (c.contentEditable) score += 10;
      const name = (c.ariaLabel || '') + ' ' + (c.placeholder || '') + ' ' + (c.name || '');
      if (/message|prompt|chat|ask|composer|talk/i.test(name)) score += 20;
      if (SEARCH_LIKE.test(name)) score -= 60;
      return score;
    }

    function scoreSend(c) {
      let score = 0;
      if (!c) return -Infinity;
      if (c.hidden || c.zeroSize) return -1000;
      if (c.disabled || c.ariaDisabled) score -= 40;
      if (c.inSidePanel) return -1000;
      if (c.visible) score += 30;
      if (c.providerHint) score += 100;
      if (c.calibrated) score += 120;
      if (c.typeSubmit) score += 40;
      if (c.idSuggestsSend) score += 50;
      if (c.nameSuggestsSend) score += 45;
      if (c.nearComposer) score += 40;
      if (c.enabled) score += 25;
      if (c.id === 'composer-submit-button') score += 80;
      if (/^send prompt$/i.test(c.ariaLabel || '')) score += 70;
      return score;
    }

    const hintComposerEls = new Set(queryAll(cfg.composerHints));
    const hintSendEls = new Set(queryAll(cfg.submitHints));
    const composerEls = unique([
      ...hintComposerEls,
      ...queryAll(cfg.genericComposer),
    ]);
    const sendEls = unique([
      ...hintSendEls,
      ...queryAll(cfg.genericSubmit),
      ...[...document.querySelectorAll('button, [role="button"], input[type="submit"]')],
    ]);

    const composerCandidates = composerEls.map((el, index) => {
      const r = rectInfo(el);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const name = el.getAttribute('name') || '';
      const labelBlob = ariaLabel + ' ' + placeholder + ' ' + name;
      const disabled =
        el.disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.getAttribute('contenteditable') === 'false';
      const editable =
        !disabled &&
        (el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          el.isContentEditable ||
          el.getAttribute('contenteditable') === 'true' ||
          el.getAttribute('role') === 'textbox');
      return {
        index,
        tag: el.tagName,
        id: el.id || '',
        ariaLabel,
        placeholder,
        name,
        roleTextbox: el.getAttribute('role') === 'textbox',
        contentEditable: el.isContentEditable || el.getAttribute('contenteditable') === 'true',
        visible: isVisible(el),
        hidden: !isVisible(el),
        zeroSize: r.area < 4,
        disabled,
        editable,
        focusable: typeof el.focus === 'function',
        providerHint: hintComposerEls.has(el),
        calibrated: matchesFingerprint(el, cfg.calibratedComposer),
        searchLike: SEARCH_LIKE.test(labelBlob),
        inSidePanel: inExtensionUi(el),
        area: r.area,
        bottomProximity: r.bottomProximity,
        nearSend: false,
        centerX: r.centerX,
        centerY: r.centerY,
        fingerprint: fingerprint(el),
      };
    });

    const sendCandidates = sendEls.map((el, index) => {
      const r = rectInfo(el);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const id = el.id || '';
      const text = (el.innerText || el.textContent || '').trim().slice(0, 40);
      const nameBlob = (ariaLabel + ' ' + title + ' ' + id + ' ' + text).toLowerCase();
      const disabled =
        el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      return {
        index,
        tag: el.tagName,
        id,
        ariaLabel,
        title,
        text,
        typeSubmit: (el.getAttribute('type') || '').toLowerCase() === 'submit',
        idSuggestsSend: /send|submit/i.test(id),
        nameSuggestsSend: /\\b(send|submit)\\b/i.test(nameBlob),
        visible: isVisible(el),
        hidden: !isVisible(el),
        zeroSize: r.area < 4,
        disabled,
        ariaDisabled: el.getAttribute('aria-disabled') === 'true',
        enabled: !disabled,
        providerHint: hintSendEls.has(el),
        calibrated: matchesFingerprint(el, cfg.calibratedSend),
        inSidePanel: inExtensionUi(el),
        nearComposer: false,
        centerX: r.centerX,
        centerY: r.centerY,
        fingerprint: fingerprint(el),
      };
    }).filter((c) => c.nameSuggestsSend || c.typeSubmit || c.providerHint || c.calibrated || c.idSuggestsSend);

    // Proximity boosts.
    for (const cc of composerCandidates) {
      for (const sc of sendCandidates) {
        const dist = Math.hypot(cc.centerX - sc.centerX, cc.centerY - sc.centerY);
        if (dist < 280) {
          cc.nearSend = true;
          sc.nearComposer = true;
        }
      }
    }

    function bestOf(list, scorer) {
      let best = null;
      let bestScore = -Infinity;
      for (const c of list) {
        const s = scorer(c);
        c.score = s;
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      return best && bestScore >= 0 ? best : null;
    }

    const bestComposer = bestOf(composerCandidates, scoreComposer);
    const bestSend = bestOf(sendCandidates, scoreSend);

    // Build stable CSS path for re-query when possible.
    function cssPath(fp) {
      if (!fp) return null;
      if (fp.id) return '#' + CSS.escape(fp.id);
      if (fp.testId) return '[data-testid="' + fp.testId.replace(/"/g, '\\\\"') + '"]';
      if (fp.ariaLabel) return '[aria-label="' + fp.ariaLabel.replace(/"/g, '\\\\"') + '"]';
      return null;
    }

    return {
      composer: bestComposer
        ? {
            ...bestComposer,
            method: bestComposer.calibrated
              ? 'calibrated'
              : bestComposer.providerHint
                ? 'provider_hint'
                : 'semantic',
            selector: cssPath(bestComposer.fingerprint),
          }
        : null,
      send: bestSend
        ? {
            ...bestSend,
            method: bestSend.calibrated
              ? 'calibrated'
              : bestSend.providerHint
                ? 'provider_hint'
                : 'semantic',
            selector: cssPath(bestSend.fingerprint),
          }
        : null,
      composerCount: composerCandidates.length,
      sendCount: sendCandidates.length,
      discovery: {
        composerFound: Boolean(bestComposer),
        sendFound: Boolean(bestSend),
        calibrationRequired: !bestComposer || !bestSend,
      },
    };
  })()`;
}

/**
 * Page script: given fingerprints/selectors, return live actionability.
 */
export function buildActionabilityScript({ composerFp, sendFp, composerSelector, sendSelector }) {
  return `(() => {
    const composerFp = ${JSON.stringify(composerFp)};
    const sendFp = ${JSON.stringify(sendFp)};
    const composerSelector = ${JSON.stringify(composerSelector)};
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

    function find(sel, fp, fallbacks) {
      if (sel) {
        try {
          const el = document.querySelector(sel);
          if (el) return el;
        } catch (_) {}
      }
      if (fp?.id) {
        const el = document.getElementById(fp.id);
        if (el) return el;
      }
      for (const s of fallbacks || []) {
        try {
          for (const el of document.querySelectorAll(s)) {
            if (matchFp(el, fp) || !fp) return el;
          }
        } catch (_) {}
      }
      // last: scan
      if (fp) {
        for (const el of document.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"], button, [role="button"]')) {
          if (matchFp(el, fp)) return el;
        }
      }
      return null;
    }

    const composer = find(composerSelector, composerFp, ['#prompt-textarea', '[contenteditable="true"]', 'textarea', '[role="textbox"]']);
    const send = find(sendSelector, sendFp, ['#composer-submit-button', 'button[type="submit"]', 'button[aria-label="Send prompt"]']);

    function info(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      return {
        connected: el.isConnected,
        visible: isVisible(el),
        disabled,
        ariaDisabled: el.getAttribute('aria-disabled') === 'true',
        pointerEvents: getComputedStyle(el).pointerEvents,
        width: r.width,
        height: r.height,
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2,
        actionable: el.isConnected && isVisible(el) && !disabled && getComputedStyle(el).pointerEvents !== 'none' && r.width > 1 && r.height > 1,
      };
    }

    return { composer: info(composer), send: info(send), hasComposer: !!composer, hasSend: !!send };
  })()`;
}
