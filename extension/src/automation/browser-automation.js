/**
 * Single shared browser-turn pipeline.
 * Used by both adapter browser_request and side-panel development test.
 *
 * Engine: direct CDP via chrome.debugger (no puppeteer.launch, no remote port).
 */

import { getProviderById, matchProviderByOrigin } from '../provider-registry.js';
import { OperationStage } from '../panel-state-model.js';
import { AutomationError, ErrorCodes } from './automation-errors.js';
import { createCdpClient, sleep } from './cdp-client.js';
import {
  buildDiscoveryScript,
  buildActionabilityScript,
} from './element-discovery.js';
import { buildWritePromptScript } from './composer-controller.js';
import {
  buildClickSendScript,
  buildSubmissionEvidenceScript,
  createClickOnceGuard,
} from './submission-controller.js';
import {
  buildBaselineScript,
  buildExtractAssistantScript,
  createStabilityTracker,
  isUserPromptEcho,
} from './response-observer.js';
import { buildAdapterPageValidationScript } from '../provider-adapter-registry.js';

const ENGINE = 'direct-cdp';

function fail(code, message, diagnostics) {
  throw new AutomationError(code, message, diagnostics);
}

function buildVerifyPromptScript({ composerFp, composerSelector, prompt }) {
  return `(() => {
    const expected = ${JSON.stringify(prompt)};
    const composerFp = ${JSON.stringify(composerFp)};
    const composerSelector = ${JSON.stringify(composerSelector)};

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    let el = null;
    try { if (composerSelector) el = document.querySelector(composerSelector); } catch (_) {}
    if (!el && composerFp?.id) el = document.getElementById(composerFp.id);
    if (!el) {
      el = document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea');
    }
    if (!el) return { ok: false, code: 'composer_not_found' };

    const value = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
      ? String(el.value || '')
      : String(el.innerText || el.textContent || '');
    const norm = (s) => String(s).replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    // Exact ownership is important: containment accepts a stale composer with
    // multiple concatenated TETHER requests, which the provider will not obey.
    const ok = norm(value) === norm(expected);
    return { ok, length: value.length, preview: value.slice(0, 120) };
  })()`;
}

/**
 * @param {object} deps
 */
export function createBrowserAutomation({ transport, calibrationStore, adapterRegistry } = {}) {
  const cdp = createCdpClient(transport);

  /** @type {Map<string, { promise: Promise<any>, result?: any, error?: any, status: string }>} */
  const idempotency = new Map();

  /** @type {Map<string, AbortController>} */
  const inflight = new Map();

  function correlationKey(extensionInstanceId, browserSessionId, requestId) {
    return `${extensionInstanceId}::${browserSessionId}::${requestId}`;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      fail(ErrorCodes.OPERATION_CANCELLED, 'Operation cancelled');
    }
  }

  async function ensureAttached(tabId, onStage) {
    onStage?.(OperationStage.ATTACHING_DEBUGGER);
    try {
      await transport.attach(tabId);
    } catch (err) {
      fail(
        ErrorCodes.DEBUGGER_ATTACH_FAILED,
        err?.message || 'Failed to attach debugger',
        { tabId }
      );
    }
  }

  async function wakeBackgroundTab(tabId) {
    // FluidGlass previously kept a page-owned animation frame alive as an
    // accidental side effect. Explicitly keep the provider target active and
    // focused instead, without changing the user's selected browser tab.
    await transport.sendCommand(tabId, 'Page.enable').catch(() => {})
    await Promise.all([
      transport.sendCommand(tabId, 'Page.setWebLifecycleState', { state: 'active' }).catch(() => {}),
      transport.sendCommand(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {}),
    ])
  }

  function resolveProvider(providerId, origin) {
    return (
      (providerId && getProviderById(providerId)) ||
      matchProviderByOrigin(origin) ||
      null
    );
  }

  async function getCalibration(origin) {
    if (!calibrationStore) return null;
    if (typeof calibrationStore.get === 'function') {
      return calibrationStore.get(origin);
    }
    return calibrationStore[origin] || null;
  }

  async function request(options) {
    const {
      requestId,
      browserSessionId,
      tabId,
      origin,
      providerId,
      prompt,
      signal,
      extensionInstanceId = 'local',
      onStage,
      onProgress,
      timeoutMs = 120000,
      clearFirst = true,
    } = options || {};

    if (tabId == null) {
      fail(ErrorCodes.TAB_UNAVAILABLE, 'tabId is required');
    }
    if (typeof prompt !== 'string') {
      fail(ErrorCodes.PROMPT_WRITE_FAILED, 'prompt must be a string');
    }

    const key = correlationKey(extensionInstanceId, browserSessionId, requestId);

    const existing = idempotency.get(key);
    if (existing) {
      if (existing.status === 'pending') return existing.promise;
      if (existing.status === 'completed') return existing.result;
      if (existing.status === 'failed') throw existing.error;
    }

    const ac = new AbortController();
    inflight.set(key, ac);

    const linked = {
      get aborted() {
        return ac.signal.aborted || Boolean(signal?.aborted);
      },
    };

    const runPromise = (async () => {
      const stage = (name, extra) => {
        onStage?.(name, extra);
        onProgress?.({ stage: name, ...extra });
      };

      try {
        stage(OperationStage.VALIDATING_SESSION, { tabId, browserSessionId });
        throwIfAborted(linked);

        await ensureAttached(tabId, stage);
        await wakeBackgroundTab(tabId);
        throwIfAborted(linked);

        const provider = resolveProvider(providerId, origin);
        const calibration = await getCalibration(origin);
        let adapter = adapterRegistry
          ? await adapterRegistry.resolve(origin, { refresh: true })
          : null;
        if (adapter && adapter.source !== 'packaged') {
          const validation = await cdp.evaluate(
            tabId,
            buildAdapterPageValidationScript(adapter)
          );
          if (!validation?.valid) {
            adapter = await adapterRegistry.reject(origin, adapter.adapterVersion);
          }
        }
        const calibratedComposerSelectors = fingerprintSelectors(calibration?.composer);
        const calibratedSendSelectors = fingerprintSelectors(calibration?.send);
        const response = responseConfiguration(calibration?.responseCalibration, adapter);
        const composerHints = uniqueSelectors(
          calibratedComposerSelectors,
          adapter?.composer?.selectors,
          provider?.composerHints
        );
        const submitHints = uniqueSelectors(
          calibratedSendSelectors,
          adapter?.send?.selectors,
          provider?.submitHints
        );
        const stopHints = uniqueSelectors(
          adapter?.completion?.stopSelectors,
          provider?.stopHints
        );
        const progressHints = uniqueSelectors(
          adapter?.completion?.progressSelectors
        );

        stage(OperationStage.CAPTURING_BASELINE);
        const baseline = await cdp.evaluate(
          tabId,
          buildBaselineScript({
            userSelectors: provider?.userHints || [],
            assistantSelectors: provider?.assistantHints || [],
            response,
          })
        );
        throwIfAborted(linked);

        stage(OperationStage.RESOLVING_COMPOSER);
        const discovery = await cdp.evaluate(
          tabId,
          buildDiscoveryScript({
            composerHints,
            submitHints,
            calibratedComposer: calibration?.composer || null,
            calibratedSend: calibration?.send || null,
            calibratedComposerSelectors,
            calibratedSendSelectors,
          })
        );

        if (!discovery?.composer) {
          fail(ErrorCodes.COMPOSER_NOT_FOUND, 'Could not discover chat composer', {
            discovery: discovery?.discovery,
          });
        }

        onProgress?.({
          stage: OperationStage.RESOLVING_COMPOSER,
          discovery: {
            composerFound: true,
            sendFound: Boolean(discovery.send),
            composerMethod: discovery.composer.method,
            sendMethod: discovery.send?.method,
            calibrationRequired: discovery.discovery?.calibrationRequired,
          },
        });

        stage(OperationStage.WRITING_PROMPT, { length: prompt.length });

        let writeResult = await cdp.evaluate(
          tabId,
          buildWritePromptScript({
            composerFp: discovery.composer.fingerprint,
            composerSelector: discovery.composer.selector,
            prompt,
            clearFirst,
          })
        );

        if (!writeResult?.ok) {
          try {
            await cdp.evaluate(
              tabId,
              `(() => {
                const el = document.querySelector(${JSON.stringify(discovery.composer.selector)}) ||
                  document.querySelector('#prompt-textarea') ||
                  document.querySelector('[contenteditable="true"]');
                if (el) { el.focus(); return true; }
                return false;
              })()`
            );
            await cdp.replaceFocusedText(tabId, prompt);
            await sleep(120);
            writeResult = { ok: true, fallback: 'insertText' };
          } catch {
            fail(
              writeResult?.code || ErrorCodes.PROMPT_WRITE_FAILED,
              writeResult?.message || 'Failed to write prompt'
            );
          }
        }

        stage(OperationStage.VERIFYING_PROMPT);
        // Keep lifecycle timing in the extension service worker. Page-owned
        // requestAnimationFrame is throttled/suspended in background tabs.
        await sleep(80);

        let verify = await cdp.evaluate(
          tabId,
          buildVerifyPromptScript({
            composerFp: discovery.composer.fingerprint,
            composerSelector: discovery.composer.selector,
            prompt,
          })
        );

        if (!verify?.ok) {
          try {
            await cdp.evaluate(
              tabId,
              `(() => {
                const el = document.querySelector('#prompt-textarea') ||
                  document.querySelector('[contenteditable="true"]');
                if (el) el.focus();
                return !!el;
              })()`
            );
            await cdp.replaceFocusedText(tabId, prompt);
            await sleep(150);
          } catch {
            /* fall through */
          }
          verify = await cdp.evaluate(
            tabId,
            buildVerifyPromptScript({
              composerFp: discovery.composer.fingerprint,
              composerSelector: discovery.composer.selector,
              prompt,
            })
          );
          if (!verify?.ok) {
            fail(
              ErrorCodes.PROMPT_VERIFICATION_FAILED,
              'Composer did not contain the exact prompt after write'
            );
          }
        }

        // Required async gap between write and resolving Send.
        await sleep(200);
        throwIfAborted(linked);

        stage(OperationStage.RESOLVING_SEND);
        let sendMeta = discovery.send;
        const deadlineSend = Date.now() + 15000;
        for (;;) {
          throwIfAborted(linked);
          const rediscovery = await cdp.evaluate(
            tabId,
            buildDiscoveryScript({
              composerHints,
              submitHints,
              calibratedComposer: calibration?.composer || null,
              calibratedSend: calibration?.send || null,
              calibratedComposerSelectors,
              calibratedSendSelectors,
            })
          );
          sendMeta = rediscovery?.send || sendMeta;

          const act = await cdp.evaluate(
            tabId,
            buildActionabilityScript({
              composerFp: discovery.composer.fingerprint,
              sendFp: sendMeta?.fingerprint,
              composerSelector: discovery.composer.selector,
              sendSelector: sendMeta?.selector,
            })
          );

          if (act?.send?.actionable) break;
          if (Date.now() > deadlineSend) {
            fail(
              sendMeta
                ? ErrorCodes.SEND_NOT_ACTIONABLE
                : ErrorCodes.SEND_NOT_FOUND,
              sendMeta
                ? 'Send control never became actionable'
                : 'Send control not found'
            );
          }
          await sleep(120);
        }

        stage(OperationStage.SUBMITTING);
        const clickGuard = createClickOnceGuard();
        clickGuard.click();

        const clickResult = await cdp.evaluate(
          tabId,
          buildClickSendScript({
            sendFp: sendMeta.fingerprint,
            sendSelector: sendMeta.selector,
          })
        );

        if (!clickResult?.clickable) {
          fail(
            clickResult?.code || ErrorCodes.SEND_NOT_ACTIONABLE,
            clickResult?.message || 'Send click failed',
            clickResult?.diagnostics
          );
        }

        // Use a real CDP pointer sequence rather than `element.click()`. Some
        // controlled composer implementations ignore a synthetic DOM click.
        await cdp.mouseClickAt(tabId, clickResult.centerX, clickResult.centerY);

        stage(OperationStage.VERIFYING_SUBMISSION);
        let submitted = false;
        const submitDeadline = Date.now() + 20000;
        while (Date.now() < submitDeadline) {
          throwIfAborted(linked);
          const evidence = await cdp.evaluate(
            tabId,
            buildSubmissionEvidenceScript({
              baseline: {
                ...baseline,
                composerText: prompt,
                composerLength: prompt.length,
              },
              promptPreview: prompt.slice(0, 200),
              stopHints,
            })
          );
          if (evidence?.submitted) {
            submitted = true;
            break;
          }
          await sleep(200);
        }
        if (!submitted) {
          fail(
            ErrorCodes.SUBMISSION_NOT_OBSERVED,
            'Submission was not observed after clicking Send'
          );
        }

        stage(OperationStage.OBSERVING_RESPONSE);
        const stability = createStabilityTracker({ stableMs: 900 });
        const observeDeadline = Date.now() + timeoutMs;
        let lastExtract = null;

        while (Date.now() < observeDeadline) {
          throwIfAborted(linked);
          const extract = await cdp.evaluate(
            tabId,
            buildExtractAssistantScript({
              baseline,
              stopHints,
              progressHints,
              response,
            })
          );
          lastExtract = extract;

          if (extract?.found && extract.text) {
            if (isUserPromptEcho(extract.text, prompt)) {
              await sleep(250);
              continue;
            }
            const st = stability.update(extract.text, {
              streaming: Boolean(extract.streaming),
            });
            onProgress?.({
              stage: extract.streaming
                ? OperationStage.OBSERVING_RESPONSE
                : OperationStage.WAITING_FOR_STABILITY,
              text: extract.text,
              streaming: extract.streaming,
            });
            if (st.stable) {
              stage(OperationStage.COMPLETE);
              return {
                text: extract.text,
                engine: ENGINE,
                diagnostics: {
                  composerMethod: discovery.composer.method,
                  sendMethod: sendMeta?.method,
                  assistantCount: extract.assistantCount,
                },
              };
            }
          } else {
            onProgress?.({
              stage: OperationStage.OBSERVING_RESPONSE,
              text: extract?.text || '',
              streaming: Boolean(extract?.streaming),
            });
          }
          await sleep(350);
        }

        if (lastExtract?.text && !isUserPromptEcho(lastExtract.text, prompt)) {
          stage(OperationStage.COMPLETE);
          return {
            text: lastExtract.text,
            engine: ENGINE,
            diagnostics: { timedOut: true },
          };
        }

        fail(
          ErrorCodes.RESPONSE_TIMEOUT,
          'Timed out waiting for a stable assistant response',
          { lastLength: lastExtract?.length || 0 }
        );
      } finally {
        inflight.delete(key);
      }
    })();

    idempotency.set(key, { status: 'pending', promise: runPromise });

    try {
      const result = await runPromise;
      idempotency.set(key, { status: 'completed', result, promise: runPromise });
      return result;
    } catch (error) {
      const wrapped =
        error instanceof AutomationError
          ? error
          : new AutomationError(
              error?.code || 'failed',
              error?.message || String(error)
            );
      idempotency.set(key, {
        status: 'failed',
        error: wrapped,
        promise: runPromise,
      });
      throw wrapped;
    }
  }

  function cancel({
    requestId,
    browserSessionId,
    extensionInstanceId = 'local',
  }) {
    const key = correlationKey(extensionInstanceId, browserSessionId, requestId);
    const ac = inflight.get(key);
    if (ac) {
      ac.abort();
      return true;
    }
    return false;
  }

  async function release(tabId) {
    try {
      await transport.detach(tabId);
    } catch {
      /* ignore */
    }
  }

  function getEngine() {
    return ENGINE;
  }

  function _idempotencyMap() {
    return idempotency;
  }

  return {
    request,
    cancel,
    release,
    getEngine,
    _idempotencyMap,
    correlationKey,
  };
}

export { ENGINE };

function fingerprintSelectors(fingerprint) {
  if (!fingerprint) return [];
  return uniqueSelectors([
    fingerprint.primarySelector,
    ...(fingerprint.fallbackSelectors || []),
  ]);
}

function responseConfiguration(responseCalibration, adapter) {
  const calibrated = responseCalibration
    ? {
        rootSelectors: fingerprintSelectors(responseCalibration.conversationRoot),
        turnSelectors: fingerprintSelectors(responseCalibration.assistantTurn),
        contentSelectors: fingerprintSelectors(responseCalibration.assistantContent),
      }
    : null;
  const remote = adapter?.response ?? null;
  if (!calibrated && !remote) return null;
  return {
    rootSelectors: calibrated?.rootSelectors ?? [],
    turnSelectors: calibrated?.turnSelectors?.length
      ? calibrated.turnSelectors
      : remote?.turnSelectors ?? [],
    contentSelectors: calibrated?.contentSelectors?.length
      ? calibrated.contentSelectors
      : remote?.contentSelectors ?? [],
    excludeSelectors: remote?.excludeSelectors ?? [],
  };
}

function uniqueSelectors(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}
