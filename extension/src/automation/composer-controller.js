/**
 * Exact prompt insertion for textarea/input and contenteditable.
 * Executed inside the tab via CDP Runtime.evaluate.
 */

export function buildWritePromptScript({
  composerFp,
  composerSelector,
  prompt,
  clearFirst = true,
}) {
  // prompt is injected as JSON string so it is exact and unescaped incorrectly.
  return `(() => {
    const prompt = ${JSON.stringify(prompt)};
    const clearFirst = ${JSON.stringify(Boolean(clearFirst))};
    const composerFp = ${JSON.stringify(composerFp)};
    const composerSelector = ${JSON.stringify(composerSelector)};

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    function findComposer() {
      if (composerSelector) {
        try {
          const el = document.querySelector(composerSelector);
          if (el) return el;
        } catch (_) {}
      }
      if (composerFp?.id) {
        const el = document.getElementById(composerFp.id);
        if (el) return el;
      }
      const sels = ['#prompt-textarea', '[data-testid="prompt-textarea"]', '[contenteditable="true"]', 'textarea', '[role="textbox"]', 'input[type="text"]'];
      for (const s of sels) {
        try {
          for (const el of document.querySelectorAll(s)) {
            if (!composerFp || matchFp(el, composerFp)) return el;
          }
        } catch (_) {}
      }
      return null;
    }

    function setNativeValue(el, value) {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
    }

    function dispatchInput(el, data, inputType) {
      try {
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: inputType || 'insertText',
          data: data ?? null,
        }));
      } catch (_) {
        el.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
      }
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: inputType || 'insertText',
          data: data ?? null,
        }));
      } catch (_) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    function readValue(el) {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        return String(el.value || '');
      }
      return String(el.innerText || el.textContent || '');
    }

    const el = findComposer();
    if (!el) {
      return { ok: false, code: 'composer_not_found', message: 'Composer element missing' };
    }

    const editable =
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'INPUT' ||
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true';
    if (!editable || el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, code: 'composer_not_editable', message: 'Composer is not editable' };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    try { el.focus(); } catch (_) {}
    try { el.click(); } catch (_) {}

    const isTextField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

    if (isTextField) {
      if (clearFirst) {
        setNativeValue(el, '');
        dispatchInput(el, '', 'deleteContentBackward');
      }
      setNativeValue(el, prompt);
      dispatchInput(el, prompt, 'insertText');
      try {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    } else {
      // contenteditable / ProseMirror
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      if (clearFirst) {
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } catch (_) {}
        dispatchInput(el, null, 'deleteContentBackward');
      }

      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, prompt);
      } catch (_) {
        inserted = false;
      }

      if (!inserted) {
        // Fallback: replace children with a text node + input events
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(document.createTextNode(prompt));
        dispatchInput(el, prompt, 'insertText');
      } else {
        dispatchInput(el, prompt, 'insertText');
      }
    }

    const value = readValue(el);
    const normalized = value.replace(/\\u00a0/g, ' ').trimEnd();
    const expected = String(prompt).replace(/\\u00a0/g, ' ').trimEnd();
    // A previous implementation accepted a substring match. That let a
    // failed clear append a new request to an older request and falsely report
    // success. A browser turn must own the entire composer value.
    const ok = normalized === expected || normalized === expected + '\\n';

    return {
      ok,
      code: ok ? 'ok' : 'prompt_verification_failed',
      message: ok ? 'written' : 'Composer value did not match prompt',
      length: value.length,
      preview: value.slice(0, 120),
      tag: el.tagName,
      contentEditable: !!el.isContentEditable,
    };
  })()`;
}

/**
 * Pure helpers for unit tests (mirror of native setter semantics).
 */
export function applyNativeValueSetter(el, value) {
  // In jsdom-less node tests we just assign (page script uses prototype setter).
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.value = value;
  } else {
    el.textContent = value;
  }
  return el.value ?? el.textContent;
}

export function writeTextareaValue(el, prompt, { clearFirst = true } = {}) {
  if (clearFirst) el.value = '';
  el.value = prompt;
  return el.value;
}

export function writeContentEditable(el, prompt, { clearFirst = true } = {}) {
  if (clearFirst) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  el.appendChild(globalThis.document
    ? document.createTextNode(prompt)
    : { textContent: prompt, nodeType: 3 });
  if (!globalThis.document) {
    el.textContent = prompt;
  }
  return el.innerText || el.textContent || '';
}
