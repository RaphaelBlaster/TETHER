/**
 * Provider registry — hints only; execution stays in the generic automation engine.
 */

export const PROVIDERS = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    origins: ['https://chatgpt.com', 'https://chat.openai.com'],
    hostPatterns: [/^chatgpt\.com$/i, /^chat\.openai\.com$/i],
    composerHints: [
      '#prompt-textarea',
      'div#prompt-textarea.ProseMirror',
      '[data-testid="prompt-textarea"]',
      "[contenteditable='true'][role='textbox']",
      'form [contenteditable="true"]',
    ],
    submitHints: [
      'button#composer-submit-button',
      '#composer-submit-button',
      'button[data-testid="send-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      "button[aria-label='Send prompt']",
      'button[aria-label="Send prompt"]',
      'button[type="submit"]',
    ],
    stopHints: [
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label*="Stop"]',
    ],
    assistantHints: [
      '[data-message-author-role="assistant"]',
      '[data-turn="assistant"]',
      'article[data-turn="assistant"]',
    ],
    userHints: [
      '[data-message-author-role="user"]',
      '[data-turn="user"]',
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    origins: ['https://gemini.google.com'],
    hostPatterns: [/^gemini\.google\.com$/i],
    composerHints: [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      '[contenteditable="true"][aria-label*="prompt" i]',
      '[contenteditable="true"][aria-label*="Enter" i]',
      'div[contenteditable="true"]',
    ],
    submitHints: [
      'button[aria-label*="Send" i]',
      'button.send-button',
      'button[mattooltip*="Send" i]',
      'button[type="submit"]',
    ],
    stopHints: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
    ],
    assistantHints: [
      'model-response',
      '.model-response-text',
      '[data-message-author-role="model"]',
      '.response-container',
    ],
    userHints: ['.user-query', '[data-message-author-role="user"]'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    origins: ['https://chat.deepseek.com'],
    hostPatterns: [/^chat\.deepseek\.com$/i],
    composerHints: [
      'textarea',
      '[contenteditable="true"]',
      'textarea#chat-input',
      '.chat-input textarea',
    ],
    submitHints: [
      'button[type="submit"]',
      'div[role="button"][aria-label*="Send" i]',
      'button[aria-label*="Send" i]',
      '.send-button',
    ],
    stopHints: ['button[aria-label*="Stop" i]'],
    assistantHints: ['.ds-markdown', '.message-assistant', '[class*="assistant"]'],
    userHints: ['.message-user', '[class*="user"]'],
  },
  {
    id: 'claude',
    label: 'Claude',
    origins: ['https://claude.ai'],
    hostPatterns: [/^claude\.ai$/i],
    composerHints: [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][translate="no"]',
      'fieldset [contenteditable="true"]',
      '[contenteditable="true"]',
    ],
    submitHints: [
      'button[aria-label="Send Message"]',
      'button[aria-label*="Send" i]',
      'button[type="submit"]',
    ],
    stopHints: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Interrupt" i]',
    ],
    assistantHints: [
      '[data-is-streaming]',
      '.font-claude-message',
      '[data-test-render-count]',
    ],
    userHints: ['.font-user-message'],
  },
];

export function getProviderById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

export function matchProviderByOrigin(originOrUrl) {
  let host = '';
  let origin = '';
  try {
    const u = new URL(originOrUrl);
    host = u.hostname;
    origin = u.origin;
  } catch {
    return null;
  }

  for (const provider of PROVIDERS) {
    if (provider.origins?.some((o) => o === origin)) {
      return provider;
    }
    if (provider.hostPatterns?.some((re) => re.test(host))) {
      return provider;
    }
  }
  return null;
}

export function describeProviderForOrigin(originOrUrl) {
  const provider = matchProviderByOrigin(originOrUrl);
  if (provider) {
    return {
      providerId: provider.id,
      label: provider.label,
      provider,
    };
  }
  try {
    const u = new URL(originOrUrl);
    return {
      providerId: 'generic',
      label: u.hostname || 'Unknown site',
      provider: null,
    };
  } catch {
    return {
      providerId: 'generic',
      label: 'Unknown site',
      provider: null,
    };
  }
}

export function genericComposerSelectors() {
  return [
    'textarea',
    'input[type="text"]',
    'input:not([type])',
    '[contenteditable="true"]',
    '[role="textbox"]',
  ];
}

export function genericSubmitSelectors() {
  return [
    'button[type="submit"]',
    'button#composer-submit-button',
    '#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button[title*="Send" i]',
    '[role="button"][aria-label*="Send" i]',
  ];
}

// Compatibility surface used by the existing session, permission, calibration,
// and panel code. Provider execution now uses the registry above; this keeps
// the pre-existing UI model stable.
const RESTRICTED_WEB_ORIGINS = new Set([
  'https://chromewebstore.google.com',
  'https://chrome.google.com',
  'https://microsoftedge.microsoft.com',
])

export function inspectSite(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'restricted', reason: 'invalid_url' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || RESTRICTED_WEB_ORIGINS.has(parsed.origin)) {
    return { kind: 'restricted', reason: 'browser_restricted' }
  }
  const provider = matchProviderByOrigin(parsed.href)
  const conversationId = provider?.id === 'chatgpt'
    ? (/^\/c\/([^/?#]+)/.exec(parsed.pathname)?.[1] ? decodeURIComponent(/^\/c\/([^/?#]+)/.exec(parsed.pathname)[1]) : null)
    : null
  return {
    kind: 'web',
    origin: parsed.origin,
    host: parsed.hostname,
    permissionPattern: `${parsed.origin}/*`,
    calibrationKey: parsed.origin,
    providerId: provider?.id ?? `site:${parsed.origin}`,
    label: provider?.label ?? parsed.hostname,
    conversationId,
    hasAdapter: Boolean(provider),
    providerKind: provider ? 'llm' : 'generic',
  }
}

export function detectProvider(url) {
  const site = inspectSite(url)
  return site.kind === 'web' ? site : null
}
