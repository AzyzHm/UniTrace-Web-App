import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { connectDb, disconnectDb } from '../src/db/connection.js';
import { createDeclarationRepository } from '../src/repositories/declarations/declaration.repository.js';
import { createUserRepository } from '../src/repositories/users/user.repository.js';
import { createPasswordHasher } from '../src/services/auth/password-hasher.js';
import { runSeed } from '../src/seed/run-seed.js';

// The seed bypasses the validators, so this repeats the password rule of the register schema.
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

async function main() {
  // The seed creates accounts with a password the developer knows, never acceptable in production.
  if (env.nodeEnv === 'production') {
    throw new Error('The seed adds test accounts and refuses to run when NODE_ENV=production');
  }

  // Read from the environment so no default credential is ever stored in the repository.
  const password = process.env.SEED_PASSWORD;
  if (!password || !PASSWORD_RULE.test(password)) {
    throw new Error(
      'Set SEED_PASSWORD (8 to 72 characters, at least one letter and one digit) before running the seed',
    );
  }

  await connectDb(env.mongoUri);
  // finally: close the connection even when the seed fails, otherwise the process cannot exit.
  try {
    const result = await runSeed({
      userRepository: createUserRepository(),
      declarationRepository: createDeclarationRepository(),
      passwordHasher: createPasswordHasher(),
      password,
      // First allowed domain, so seeded emails follow the same rule as real signups.
      emailDomain: env.allowedEmailDomains[0],
      logger,
    });
    if (!result.skipped) {
      logger.info(`Log in as admin@${env.allowedEmailDomains[0]} with your SEED_PASSWORD`);
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
