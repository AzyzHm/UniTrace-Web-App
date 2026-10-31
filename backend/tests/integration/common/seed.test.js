import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { createDeclarationRepository } from '../../../src/repositories/declarations/declaration.repository.js';
import { createUserRepository } from '../../../src/repositories/users/user.repository.js';
import { runSeed } from '../../../src/seed/run-seed.js';
import { SEED_DECLARATIONS, SEED_USERS } from '../../../src/seed/seed-data.js';
import { createPasswordHasher } from '../../../src/services/auth/password-hasher.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const NOW = new Date('2026-10-20T10:00:00Z');
const PASSWORD = 'Secret123';

describe('seed', () => {
  const passwordHasher = createPasswordHasher({ cost: 4 });
  const seed = () =>
    runSeed({
      userRepository: createUserRepository(),
      declarationRepository: createDeclarationRepository(),
      passwordHasher,
      password: PASSWORD,
      emailDomain: 'isamm.uma.tn',
      now: NOW,
    });

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await Declaration.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('creates the users and the declarations', async () => {
    const result = await seed();

    expect(result).toEqual({
      skipped: false,
      users: SEED_USERS.length,
      declarations: SEED_DECLARATIONS.length,
    });
    expect(await User.countDocuments()).toBe(SEED_USERS.length);
    expect(await Declaration.countDocuments()).toBe(SEED_DECLARATIONS.length);
  });

  it('creates one verified admin whose password is the one given', async () => {
    await seed();

    const admin = await User.findOne({ email: 'admin@isamm.uma.tn' }).select('+password');

    expect(admin.role).toBe('admin');
    expect(admin.isEmailVerified).toBe(true);
    expect(await passwordHasher.compare(PASSWORD, admin.password)).toBe(true);
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);
  });

  it('links every declaration to a seeded user, with a date in the past', async () => {
    await seed();

    const users = await User.find();
    const ids = users.map((user) => String(user._id));
    for (const declaration of await Declaration.find()) {
      expect(ids).toContain(String(declaration.owner));
      expect(declaration.date.getTime()).toBeLessThan(NOW.getTime());
    }
  });

  it('keeps the private info the seed data gives', async () => {
    await seed();

    const withInfo = await Declaration.find().select('+privateInfo');

    expect(withInfo.filter((d) => d.privateInfo).length).toBe(
      SEED_DECLARATIONS.filter((d) => d.privateInfo).length,
    );
  });

  it('does nothing the second time', async () => {
    await seed();

    const second = await seed();

    expect(second).toEqual({ skipped: true, users: 0, declarations: 0 });
    expect(await User.countDocuments()).toBe(SEED_USERS.length);
    expect(await Declaration.countDocuments()).toBe(SEED_DECLARATIONS.length);
  });
});
