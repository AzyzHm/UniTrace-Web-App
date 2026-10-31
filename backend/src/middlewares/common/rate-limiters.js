import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RATE_LIMITS } from '../../constants/common/rate-limits.js';
import { RateLimitedError } from '../../exceptions/app-error.js';

export const noLimit = (req, res, next) => next();

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

function emailOf(req) {
  return typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase().slice(0, 254)
    : '';
}

export function createRateLimiters({ limits = {} } = {}) {
  const config = { ...RATE_LIMITS, ...limits };

  return {
    api: build(config.api),

    authFailures: build(config.authFailures, { skipSuccessfulRequests: true }),

    loginAccount: build(config.loginAccount, {
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${emailOf(req)}`,
    }),

    emailSending: build(config.emailSending),
  };
}
