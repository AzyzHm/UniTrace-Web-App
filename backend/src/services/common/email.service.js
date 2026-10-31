import { CODE_PURPOSES } from '../../constants/auth/code-purposes.js';
import { CODE_TTL_MINUTES as DEFAULT_TTL_MINUTES } from '../../constants/auth/verification-code.js';

const DEFAULT_BASE_URL = 'https://api.agentmail.to/v0';
const DEFAULT_TIMEOUT_MS = 10_000;

// Lets callers tolerate a provider failure without hiding real bugs.
export class EmailDeliveryError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'EmailDeliveryError';
    this.status = status;
  }
}

const TEMPLATES = Object.freeze({
  [CODE_PURPOSES.EMAIL_VERIFICATION]: {
    subject: 'Your UniTrace verification code',
    intro: 'Use this code to verify your email address.',
  },
  [CODE_PURPOSES.PASSWORD_RESET]: {
    subject: 'Your UniTrace password reset code',
    intro: 'Use this code to reset your password.',
  },
});

export function buildCodeEmail({ purpose, code, ttlMinutes = DEFAULT_TTL_MINUTES }) {
  const template = TEMPLATES[purpose];
  if (!template) {
    throw new Error(`buildCodeEmail(): unknown purpose "${purpose}"`);
  }

  const expiry = `It expires in ${ttlMinutes} minutes. If you did not ask for it, you can ignore this email.`;

  return {
    subject: template.subject,
    text: `${template.intro}\n\n${code}\n\n${expiry}`,
    html: [
      '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">',
      '<h2 style="margin-bottom: 8px;">UniTrace</h2>',
      `<p>${template.intro}</p>`,
      `<p style="font-size: 32px; letter-spacing: 6px; font-weight: bold;">${code}</p>`,
      `<p style="color: #555;">${expiry}</p>`,
      '</div>',
    ].join(''),
  };
}

export function createEmailService({
  apiKey,
  inboxId,
  fetchFn = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ttlMinutes = DEFAULT_TTL_MINUTES,
}) {
  if (!apiKey || !inboxId) {
    throw new Error('createEmailService(): apiKey and inboxId are required');
  }

  const sendUrl = `${baseUrl}/inboxes/${encodeURIComponent(inboxId)}/messages/send`;

  async function send(to, { subject, text, html }) {
    let response;
    try {
      response = await fetchFn(sendUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, subject, text, html }),
        // A slow provider must not keep the request hanging.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new EmailDeliveryError('Email provider is unreachable', { cause });
    }

    if (!response.ok) {
      throw new EmailDeliveryError(`Email provider answered ${response.status}`, {
        status: response.status,
      });
    }
  }

  return {
    sendVerificationCode: (to, code) =>
      send(to, buildCodeEmail({ purpose: CODE_PURPOSES.EMAIL_VERIFICATION, code, ttlMinutes })),
    sendPasswordResetCode: (to, code) =>
      send(to, buildCodeEmail({ purpose: CODE_PURPOSES.PASSWORD_RESET, code, ttlMinutes })),
  };
}

// Used when AgentMail is not configured (required in production, see config/env.js).
// It logs the code itself, so developers can sign up without a mail provider.
export function createConsoleEmailService({ logger }) {
  const log = (purpose) => async (to, code) => {
    logger.info({ to, purpose, code }, 'Email not sent (console sender)');
  };

  return {
    sendVerificationCode: log(CODE_PURPOSES.EMAIL_VERIFICATION),
    sendPasswordResetCode: log(CODE_PURPOSES.PASSWORD_RESET),
  };
}
