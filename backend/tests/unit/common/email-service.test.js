import { describe, expect, it, vi } from 'vitest';
import {
  EmailDeliveryError,
  buildCodeEmail,
  createConsoleEmailService,
  createEmailService,
} from '../../../src/services/common/email.service.js';

const CONFIG = { apiKey: 'am_secret_key', inboxId: 'unitrace@agentmail.to' };

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200 });
}

describe('buildCodeEmail', () => {
  it('puts the code in both the text and html parts', () => {
    const email = buildCodeEmail({ purpose: 'email_verification', code: '123456' });

    expect(email.text).toContain('123456');
    expect(email.html).toContain('123456');
  });

  it('uses a different subject per purpose', () => {
    const verify = buildCodeEmail({ purpose: 'email_verification', code: '111111' });
    const reset = buildCodeEmail({ purpose: 'password_reset', code: '111111' });

    expect(verify.subject).not.toBe(reset.subject);
  });

  it('states the expiry', () => {
    const email = buildCodeEmail({ purpose: 'password_reset', code: '111111', ttlMinutes: 15 });

    expect(email.text).toContain('15 minutes');
  });

  it('refuses an unknown purpose', () => {
    expect(() => buildCodeEmail({ purpose: 'newsletter', code: '111111' })).toThrow(/purpose/);
  });
});

describe('createEmailService', () => {
  it('posts the message to the AgentMail send endpoint', async () => {
    const fetchFn = okFetch();
    const service = createEmailService({ ...CONFIG, fetchFn });

    await service.sendVerificationCode('sara@isamm.uma.tn', '123456');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.agentmail.to/v0/inboxes/unitrace%40agentmail.to/messages/send');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer am_secret_key');

    const body = JSON.parse(init.body);
    expect(body.to).toBe('sara@isamm.uma.tn');
    expect(body.text).toContain('123456');
    expect(body.html).toContain('123456');
  });

  it('sends the password reset template for a reset code', async () => {
    const fetchFn = okFetch();
    const service = createEmailService({ ...CONFIG, fetchFn });

    await service.sendPasswordResetCode('sara@isamm.uma.tn', '654321');

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.subject).toMatch(/reset/i);
    expect(body.text).toContain('654321');
  });

  it('sets a timeout signal on every request', async () => {
    const fetchFn = okFetch();
    const service = createEmailService({ ...CONFIG, fetchFn });

    await service.sendVerificationCode('sara@isamm.uma.tn', '123456');

    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('throws EmailDeliveryError with the status when the provider refuses', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const service = createEmailService({ ...CONFIG, fetchFn });

    const error = await service.sendVerificationCode('sara@isamm.uma.tn', '123456').catch((e) => e);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.status).toBe(500);
    expect(error.message).not.toContain('am_secret_key');
  });

  it('wraps a network failure and keeps the cause', async () => {
    const cause = new Error('ECONNRESET');
    const fetchFn = vi.fn().mockRejectedValue(cause);
    const service = createEmailService({ ...CONFIG, fetchFn });

    const error = await service.sendVerificationCode('sara@isamm.uma.tn', '123456').catch((e) => e);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.cause).toBe(cause);
  });

  it('refuses to start without an api key or inbox id', () => {
    expect(() => createEmailService({ inboxId: CONFIG.inboxId })).toThrow(/apiKey/);
    expect(() => createEmailService({ apiKey: CONFIG.apiKey })).toThrow(/inboxId/);
  });
});

describe('createConsoleEmailService', () => {
  it('logs the code instead of sending it', async () => {
    const logger = { info: vi.fn() };
    const service = createConsoleEmailService({ logger });

    await service.sendVerificationCode('sara@isamm.uma.tn', '123456');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sara@isamm.uma.tn', code: '123456' }),
      expect.any(String),
    );
  });
});
