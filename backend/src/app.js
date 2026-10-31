import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { notFoundHandler } from './middlewares/common/not-found.js';
import { createErrorHandler } from './middlewares/common/error-handler.js';
import { createApiRouter } from './routes/index.js';

// Default logger so createApp works in tests without passing one.
const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

export function createApp({
  logger = silentLogger,
  requireAuth,
  allowedEmailDomains,
  secureCookies = false,
  corsOrigins = [],
  trustProxy = 0,
  rateLimiters = null,
  ...services
} = {}) {
  const app = express();

  // Behind a reverse proxy req.ip is the proxy address, which would put every user in the same
  // rate limit bucket. 0 means no proxy is trusted.
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use(helmet());

  // No configured origin means no CORS headers, so browsers block cross-origin calls.
  // credentials is needed for the refresh cookie.
  if (corsOrigins.length > 0) {
    app.use(cors({ origin: corsOrigins, credentials: true, maxAge: 600 }));
  }

  // Before body parsing, so a client that is over the limit costs almost nothing.
  if (rateLimiters) app.use('/api/v1', rateLimiters.api);

  // Small on purpose: no JSON endpoint needs more, and pictures go through multipart instead.
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // Outside /api/v1, so the global rate limiter never throttles a monitoring probe.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(
    '/api/v1',
    createApiRouter({
      services,
      requireAuth,
      allowedEmailDomains,
      secureCookies,
      rateLimiters: rateLimiters ?? {},
    }),
  );

  // Must come last: they catch what no route handled.
  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));

  return app;
}
