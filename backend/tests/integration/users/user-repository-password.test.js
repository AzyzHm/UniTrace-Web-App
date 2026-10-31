import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../src/models/users/user.model.js';
import { createUserRepository } from '../../../src/repositories/users/user.repository.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const HASH = '$2b$04$fakehashfakehashfakehashfakehashfakehashfakehashfak';

describe('user repository, findByIdWithPassword', () => {
  const repository = createUserRepository();

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('loads the password hash', async () => {
    const created = await repository.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: HASH,
    });

    const found = await repository.findByIdWithPassword(created._id);

    expect(found.password).toBe(HASH);
    expect(found.email).toBe('sara@isamm.uma.tn');
  });

  it('returns null for an unknown id', async () => {
    expect(await repository.findByIdWithPassword(new mongoose.Types.ObjectId())).toBeNull();
  });

  it('does not change what findById returns: still no hash', async () => {
    const created = await repository.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: HASH,
    });

    expect((await repository.findById(created._id)).password).toBeUndefined();
  });
});
