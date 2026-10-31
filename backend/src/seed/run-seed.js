import { ADMIN_USERNAME, SEED_DECLARATIONS, SEED_USERS } from './seed-data.js';

// Declaration dates are stored as days ago, so the data stays recent whenever the seed runs.
const DAY_MS = 24 * 60 * 60 * 1000;
const silentLogger = { info() {} };

export async function runSeed({
  userRepository,
  declarationRepository,
  passwordHasher,
  password,
  emailDomain,
  now = new Date(),
  logger = silentLogger,
}) {
  // The admin is the marker of an earlier run: when it exists, seeding again would only duplicate.
  const adminEmail = `${ADMIN_USERNAME}@${emailDomain}`;
  if (await userRepository.findByEmail(adminEmail)) {
    logger.info('Seed skipped: the admin already exists');
    return { skipped: true, users: 0, declarations: 0 };
  }

  // Hashed once and shared by every seed account, because bcrypt is slow on purpose.
  const passwordHash = await passwordHasher.hash(password);

  // Repositories are used directly: the services force status to pending and require the email
  // verification, which the seed accounts and the non-pending examples skip.
  const ownerIds = new Map();
  for (const { username, role, phone } of SEED_USERS) {
    const user = await userRepository.create({
      username,
      email: `${username}@${emailDomain}`,
      phone,
      password: passwordHash,
      role,
      isEmailVerified: true,
    });
    ownerIds.set(username, user._id);
  }

  for (const { owner, daysAgo, ...fields } of SEED_DECLARATIONS) {
    await declarationRepository.create({
      ...fields,
      owner: ownerIds.get(owner),
      date: new Date(now.getTime() - daysAgo * DAY_MS),
    });
  }

  logger.info(
    { users: SEED_USERS.length, declarations: SEED_DECLARATIONS.length },
    'Database seeded',
  );
  return { skipped: false, users: SEED_USERS.length, declarations: SEED_DECLARATIONS.length };
}
