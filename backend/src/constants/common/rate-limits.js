const MINUTE = 60 * 1000;

export const RATE_LIMITS = Object.freeze({
  // Global ceiling per IP. High on purpose: it only stops floods, a normal page already makes
  // several requests.
  api: Object.freeze({ windowMs: 15 * MINUTE, limit: 1500 }),
  // Counts only failed requests, per IP. It slows down password and code guessing across many
  // accounts without penalizing users who succeed.
  authFailures: Object.freeze({ windowMs: 15 * MINUTE, limit: 100 }),
  // Failed logins per IP and email pair. Strict to protect one account, and keyed on the email
  // too so people sharing the campus IP do not block each other.
  loginAccount: Object.freeze({ windowMs: 15 * MINUTE, limit: 5 }),
  // Every call sends an email, so this caps spam and the cost of the email provider.
  emailSending: Object.freeze({ windowMs: 60 * MINUTE, limit: 60 }),
});
