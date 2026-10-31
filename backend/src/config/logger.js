import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  // Readable output only in development. Everywhere else the logger keeps plain JSON lines,
  // which log tools can parse, and pino-pretty (a dev dependency) is not needed.
  ...(env.nodeEnv === 'development' && {
    transport: { target: 'pino-pretty' },
  }),
});
