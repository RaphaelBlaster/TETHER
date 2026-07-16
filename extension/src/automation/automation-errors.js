/**
 * Explicit automation error codes.
 */

export class AutomationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [diagnostics]
   */
  constructor(code, message, diagnostics = {}) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.diagnostics = sanitizeDiagnostics(diagnostics);
  }
}

export function sanitizeDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(diagnostics)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      out[k] = v.slice(0, 500);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 200) : x));
    } else {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        out[k] = String(v).slice(0, 200);
      }
    }
  }
  return out;
}

export function fail(code, message, diagnostics) {
  throw new AutomationError(code, message, diagnostics);
}

export const ErrorCodes = Object.freeze({
  NO_ACTIVE_SESSION: 'no_active_session',
  MULTIPLE_ACTIVE_SESSIONS: 'multiple_active_sessions',
  INACTIVE_SESSION: 'inactive_session',
  TAB_UNAVAILABLE: 'tab_unavailable',
  DEBUGGER_ATTACH_FAILED: 'debugger_attach_failed',
  DEBUGGER_DETACHED: 'debugger_detached',
  COMPOSER_NOT_FOUND: 'composer_not_found',
  COMPOSER_NOT_EDITABLE: 'composer_not_editable',
  PROMPT_WRITE_FAILED: 'prompt_write_failed',
  PROMPT_VERIFICATION_FAILED: 'prompt_verification_failed',
  SEND_NOT_FOUND: 'send_not_found',
  SEND_NOT_ACTIONABLE: 'send_not_actionable',
  SUBMISSION_NOT_OBSERVED: 'submission_not_observed',
  ASSISTANT_RESPONSE_NOT_FOUND: 'assistant_response_not_found',
  RESPONSE_TIMEOUT: 'response_timeout',
  OPERATION_CANCELLED: 'operation_cancelled',
  ADAPTER_DISCONNECTED: 'adapter_disconnected',
});
