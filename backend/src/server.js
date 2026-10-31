import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { EVENTS } from './constants/common/events.js';
import { createContainer } from './container/index.js';
import { connectDb, disconnectDb } from './db/connection.js';
import { createRateLimiters } from './middlewares/common/rate-limiters.js';

async function start() {
  // Connect first, so the API never accepts a request it cannot serve.
  await connectDb(env.mongoUri);

  const container = createContainer({ config: env, logger });

  // Only the id is logged, no personal data.
  container.eventBus.on(EVENTS.USER_DELETED, ({ userId }) => {
    logger.info({ userId }, 'User account deleted');
  });

  const app = createApp({
    logger,
    ...container.services,
    requireAuth: container.requireAuth,
    allowedEmailDomains: env.allowedEmailDomains,
    // Secure cookies need HTTPS, which local development does not have.
    secureCookies: env.nodeEnv === 'production',
    corsOrigins: env.corsOrigins,
    trustProxy: env.trustProxy,
    rateLimiters: createRateLimiters(),
  });
  const server = app.listen(env.port, () => {
    logger.info(`UniTrace API listening on port ${env.port} (${env.nodeEnv})`);
  });

  // server.close stops new connections and lets running requests finish before the DB closes.
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// A failed start (for example a bad database URI) exits with an error code for the process manager.
start().catch((err) => {
  logger.error({ err }, 'Failed to start the server');
  process.exit(1);
});
