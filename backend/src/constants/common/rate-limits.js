const MINUTE = 60 * 1000;
export const RATE_LIMITS = Object.freeze({
  api: Object.freeze({ windowMs: 15 * MINUTE, limit: 1500 }),
  authFailures: Object.freeze({ windowMs: 15 * MINUTE, limit: 100 }),
  loginAccount: Object.freeze({ windowMs: 15 * MINUTE, limit: 5 }),
  emailSending: Object.freeze({ windowMs: 60 * MINUTE, limit: 60 }),
});
