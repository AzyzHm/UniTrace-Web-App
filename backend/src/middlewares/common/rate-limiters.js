import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RATE_LIMITS } from '../../constants/common/rate-limits.js';
import { RateLimitedError } from '../../exceptions/app-error.js';

// Used when the app is built without limiters (the default in createApp), so routes never need
// to check whether a limiter exists.
export const noLimit = (req, res, next) => next();

// Replaces the library's default plain-text 429, so a rate limit goes through the shared error
// format and carries its wait time.
function refuse(req, res, next, options) {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil(options.windowMs / 1000);

  next(new RateLimitedError('Too many requests, please try again later', { retryAfterSeconds }));
}

function build({ windowMs, limit }, extra = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: refuse,
    ...extra,
  });
}

// Normalized so that case or spaces cannot be used to get a fresh counter for the same account.
// This runs before the body is validated (see auth.routes.js), hence the type check and the cap.
function emailOf(req) {
  return typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase().slice(0, 254)
    : '';
}

export function createRateLimiters({ limits = {} } = {}) {
  const config = { ...RATE_LIMITS, ...limits };

  return {
    // Applied to all of /api/v1 in app.js, before the body is parsed, so floods are cut off early.
    api: build(config.api),

    // Only failed requests count, so normal users are never slowed down and only guessing or
    // probing is limited.
    authFailures: build(config.authFailures, { skipSuccessfulRequests: true }),

    // Keyed by IP and email: guessing one account's password is capped, and someone on another IP
    // cannot lock the real owner out. ipKeyGenerator groups IPv6 addresses by subnet so one client
    // cannot rotate through its addresses to escape the limit.
    loginAccount: build(config.loginAccount, {
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${emailOf(req)}`,
    }),

    // Counts every request, successful or not, because each one can send an email.
    emailSending: build(config.emailSending),
  };
}
