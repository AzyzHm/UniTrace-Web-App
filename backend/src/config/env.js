import path from 'node:path';
import Joi from 'joi';

// In Joi, .empty('') makes a blank line in .env (KEY=) count as "not set", so the defaults
// and the production-only requirements below still apply to it.
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  ALLOWED_EMAIL_DOMAINS: Joi.string().default('isamm.uma.tn,isamm.u-manouba.tn'),
  // Required only in production: elsewhere the console email service logs the codes instead.
  AGENTMAIL_API_KEY: Joi.string().empty('').when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  AGENTMAIL_INBOX_ID: Joi.string().email().empty('').when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  // The two secrets have a dev default so a fresh clone runs without setup. Production has no
  // default and a minimum length, so a placeholder can never end up protecting real data.
  CODE_HASH_SECRET: Joi.string()
    .empty('')
    .min(32)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.any().default('dev-only-code-hash-secret-change-me'),
    }),
  JWT_ACCESS_SECRET: Joi.string()
    .empty('')
    .min(32)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.any().default('dev-only-jwt-access-secret-change-me'),
    }),
  // Short on purpose: an access token is stateless, so a short life limits what a stolen one
  // can do. The long session is carried by the refresh token.
  JWT_ACCESS_EXPIRES: Joi.string()
    .empty('')
    .pattern(/^\d+[smhd]$/)
    .default('15m'),
  UPLOAD_DIR: Joi.string().empty('').default('uploads'),
  // Each entry must be an exact origin (no path, no trailing slash), because the Origin header
  // sent by the browser is compared with it as a plain string.
  CORS_ORIGINS: Joi.string()
    .empty('')
    .default('')
    .custom((value) => {
      for (const origin of value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        let parsed = null;
        try {
          parsed = new URL(origin).origin;
        } catch {
          // parsed stays null, reported below
        }
        if (parsed !== origin) {
          throw new Error(`"${origin}" is not an origin such as http://localhost:5173`);
        }
      }
      return value;
    }),
  // Number of reverse proxies in front of the app. 0 by default: trusting X-Forwarded-For
  // without a real proxy would let any client fake its IP and escape the rate limiters.
  TRUST_PROXY: Joi.number().integer().min(0).max(10).default(0),
  // Unknown variables are allowed: the OS and the CI inject many that are not ours.
}).unknown(true);

// The source is a parameter so tests can validate a custom set of variables without touching
// process.env.
export function loadEnv(source = process.env) {
  // abortEarly: false reports every problem at once, instead of one failed start per mistake.
  const { value, error } = schema.validate(source, { abortEarly: false });

  if (error) {
    const lines = error.details.map((detail) => `  - ${detail.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${lines}`);
  }

  // Frozen so no code can change the configuration while the app runs.
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    mongoUri: value.MONGODB_URI,
    allowedEmailDomains: value.ALLOWED_EMAIL_DOMAINS.split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    agentmail: {
      apiKey: value.AGENTMAIL_API_KEY ?? null,
      inboxId: value.AGENTMAIL_INBOX_ID ?? null,
    },
    codeHashSecret: value.CODE_HASH_SECRET,
    jwt: {
      accessSecret: value.JWT_ACCESS_SECRET,
      accessExpires: value.JWT_ACCESS_EXPIRES,
    },
    // Absolute path, so uploads do not move if the process is started from another folder.
    uploadDir: path.resolve(value.UPLOAD_DIR),
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: value.TRUST_PROXY,
  });
}

// Validated as soon as the module is imported: a bad configuration stops the app before it
// starts, not in the middle of a request.
export const env = loadEnv();
