/**
 * Thin CDP client over debugger transport (Puppeteer-style commands).
 */

export function createCdpClient(transport) {
  async function evaluate(tabId, expression, options = {}) {
    const result = await transport.sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      ...options,
    });

    if (result?.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Runtime.evaluate failed';
      const err = new Error(desc);
      err.code = 'cdp_evaluate_failed';
      throw err;
    }
    return result?.result?.value;
  }

  async function insertText(tabId, text) {
    await transport.sendCommand(tabId, 'Input.insertText', { text });
  }

  async function dispatchKey(tabId, event) {
    await transport.sendCommand(tabId, 'Input.dispatchKeyEvent', event);
  }

  async function replaceFocusedText(tabId, text) {
    const control = {
      key: 'Control',
      code: 'ControlLeft',
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
    };
    const a = {
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    };
    const backspace = {
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    };

    await dispatchKey(tabId, { type: 'rawKeyDown', ...control });
    await dispatchKey(tabId, { type: 'rawKeyDown', ...a, modifiers: 2 });
    await dispatchKey(tabId, { type: 'keyUp', ...a, modifiers: 2 });
    await dispatchKey(tabId, { type: 'keyUp', ...control });
    await dispatchKey(tabId, { type: 'rawKeyDown', ...backspace });
    await dispatchKey(tabId, { type: 'keyUp', ...backspace });
    await insertText(tabId, text);
  }

  async function pressEnter(tabId) {
    const base = {
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    };
    await dispatchKey(tabId, { type: 'rawKeyDown', ...base, text: '\r' });
    await dispatchKey(tabId, { type: 'char', ...base, text: '\r' });
    await dispatchKey(tabId, { type: 'keyUp', ...base });
  }

  async function mouseClickAt(tabId, x, y) {
    const opts = { x, y, button: 'left', clickCount: 1 };
    await transport.sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      buttons: 1,
      ...opts,
    });
    await transport.sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      buttons: 0,
      ...opts,
    });
  }

  return {
    evaluate,
    insertText,
    replaceFocusedText,
    dispatchKey,
    pressEnter,
    mouseClickAt,
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitAnimationFrameExpression() {
  return `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
}
