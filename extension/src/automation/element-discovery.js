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
  calibratedComposerSelectors = [],
  calibratedSendSelectors = [],
} = {}) {
  const payload = {
    composerHints,
    submitHints,
    genericComposer: genericComposerSelectors(),
    genericSubmit: genericSubmitSelectors(),
    calibratedComposer,
    calibratedSend,
    calibratedComposerSelectors,
    calibratedSendSelectors,
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
    const calibratedComposerEls = new Set(queryAll(cfg.calibratedComposerSelectors));
    const calibratedSendEls = new Set(queryAll(cfg.calibratedSendSelectors));
    const composerEls = unique([
      ...calibratedComposerEls,
      ...hintComposerEls,
      ...queryAll(cfg.genericComposer),
    ]);
    const sendEls = unique([
      ...calibratedSendEls,
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
        calibrated: calibratedComposerEls.has(el) || matchesFingerprint(el, cfg.calibratedComposer),
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
      const className = typeof el.className === 'string' ? el.className : '';
      const disabled =
        el.disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        (' ' + className + ' ').includes(' ds-button--disabled ');
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
        calibrated: calibratedSendEls.has(el) || matchesFingerprint(el, cfg.calibratedSend),
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
    function cssPath(el, fp) {
      if (!el || !fp) return null;
      const candidates = [];
      if (fp.id) candidates.push('#' + CSS.escape(fp.id));
      if (fp.testId) candidates.push('[data-testid="' + fp.testId.replace(/"/g, '\\\\"') + '"]');
      if (fp.ariaLabel) candidates.push('[aria-label="' + fp.ariaLabel.replace(/"/g, '\\\\"') + '"]');
      for (const selector of candidates) {
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1 && matches[0] === el) return selector;
        } catch (_) {}
      }
      return null;
    }

    // Anonymous React controls often have no id, test-id, or accessible name.
    // Preserve an exact manifest/calibration selector when it uniquely resolves
    // the selected live node so later actionability and click passes can
    // re-query a replacement node instead of depending on a stale fingerprint.
    function configuredSelector(el, selectors) {
      if (!el) return null;
      for (const selector of selectors || []) {
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1 && matches[0] === el) return selector;
        } catch (_) {}
      }
      return null;
    }

    const composerSelector = bestComposer
      ? cssPath(composerEls[bestComposer.index], bestComposer.fingerprint) ||
        configuredSelector(composerEls[bestComposer.index], [
          ...cfg.calibratedComposerSelectors,
          ...cfg.composerHints,
        ])
      : null;
    const sendSelector = bestSend
      ? cssPath(sendEls[bestSend.index], bestSend.fingerprint) ||
        configuredSelector(sendEls[bestSend.index], [
          ...cfg.calibratedSendSelectors,
          ...cfg.submitHints,
        ])
      : null;

    return {
      composer: bestComposer
        ? {
            ...bestComposer,
            method: bestComposer.calibrated
              ? 'calibrated'
              : bestComposer.providerHint
                ? 'provider_hint'
                : 'semantic',
            selector: composerSelector,
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
            selector: sendSelector,
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
      const className = typeof el.className === 'string' ? el.className : '';
      const disabled =
        el.disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        (' ' + className + ' ').includes(' ds-button--disabled ');
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

export function buildWaitForActionableSendScript({
  waiterId,
  sendSelectors,
  stopSelectors = [],
  timeoutMs = 15_000,
  readyStableMs = 300,
}) {
  return `(() => {
    const waiterId = ${JSON.stringify(waiterId)};
    const sendSelectors = ${JSON.stringify(sendSelectors)};
    const stopSelectors = ${JSON.stringify(stopSelectors)};
    const timeoutMs = ${JSON.stringify(timeoutMs)};
    const readyStableMs = ${JSON.stringify(readyStableMs)};
    const registryKey = '__tetherSendReadinessWaiters';
    const registry = globalThis[registryKey] ||= new Map();
    registry.get(waiterId)?.cancel?.();

    return new Promise((resolve) => {
      let observer = null;
      let timeoutId = null;
      let stableId = null;
      let readyElement = null;
      let lastState = { ready: false, hasSend: false, stopVisible: false };
      let settled = false;

      function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        if (style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      }

      function queryUnique(selectors) {
        for (const selector of selectors || []) {
          if (!selector) continue;
          try {
            const matches = [...document.querySelectorAll(selector)];
            if (matches.length === 1) return { element: matches[0], selector };
          } catch (_) {}
        }
        return null;
      }

      function stopIsVisible() {
        for (const selector of stopSelectors || []) {
          try {
            if ([...document.querySelectorAll(selector)].some(isVisible)) return true;
          } catch (_) {}
        }
        return false;
      }

      function inspect() {
        const candidate = queryUnique(sendSelectors);
        const element = candidate?.element || null;
        const className = typeof element?.className === 'string' ? element.className : '';
        const label = [
          element?.getAttribute?.('aria-label'),
          element?.getAttribute?.('title'),
          element?.getAttribute?.('data-testid'),
          element?.innerText,
        ].filter(Boolean).join(' ');
        const disabled = Boolean(element) && (
          element.disabled === true ||
          element.getAttribute('aria-disabled') === 'true' ||
          /(?:^|[\\s_-])disabled(?:$|[\\s_-])/i.test(className) ||
          /(?:^|[\\s_-])loading(?:$|[\\s_-])/i.test(className)
        );
        const stopLike = /\\b(?:stop|cancel|interrupt|loading|generating|responding)\\b/i.test(label);
        const stopVisible = stopIsVisible();
        return {
          ready: Boolean(element) && isVisible(element) && !disabled && !stopLike && !stopVisible,
          hasSend: Boolean(element),
          stopVisible,
          disabled,
          stopLike,
          selector: candidate?.selector || null,
          element,
        };
      }

      function cleanup() {
        observer?.disconnect();
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (stableId !== null) clearTimeout(stableId);
        document.removeEventListener?.('transitionend', check, true);
        document.removeEventListener?.('animationend', check, true);
        globalThis.removeEventListener?.('pagehide', cancel);
        if (registry.get(waiterId)?.cancel === cancel) registry.delete(waiterId);
      }

      function finish(result) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      }

      function cancel() {
        finish({ ...lastState, ready: false, cancelled: true });
      }

      function check() {
        if (settled) return;
        const state = inspect();
        lastState = {
          ready: state.ready,
          hasSend: state.hasSend,
          stopVisible: state.stopVisible,
          disabled: state.disabled,
          stopLike: state.stopLike,
          selector: state.selector,
        };
        if (!state.ready) {
          readyElement = null;
          if (stableId !== null) clearTimeout(stableId);
          stableId = null;
          return;
        }
        if (readyElement === state.element && stableId !== null) return;
        readyElement = state.element;
        if (stableId !== null) clearTimeout(stableId);
        stableId = setTimeout(() => {
          stableId = null;
          const confirmed = inspect();
          if (confirmed.ready && confirmed.element === readyElement) {
            finish({
              ready: true,
              hasSend: true,
              stopVisible: false,
              disabled: false,
              stopLike: false,
              selector: confirmed.selector,
            });
          } else {
            readyElement = null;
            check();
          }
        }, readyStableMs);
      }

      registry.set(waiterId, { cancel });
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'aria-label', 'title', 'class', 'style', 'hidden'],
      });
      document.addEventListener?.('transitionend', check, true);
      document.addEventListener?.('animationend', check, true);
      globalThis.addEventListener?.('pagehide', cancel, { once: true });
      timeoutId = setTimeout(() => finish({ ...lastState, ready: false, timedOut: true }), timeoutMs);
      check();
    });
  })()`;
}

export function buildCancelActionableSendWaitScript(waiterId) {
  return `(() => {
    const waiter = globalThis.__tetherSendReadinessWaiters?.get(${JSON.stringify(waiterId)});
    if (!waiter) return false;
    waiter.cancel();
    return true;
  })()`;
}
