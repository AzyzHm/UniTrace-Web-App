import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../src/exceptions/app-error.js';
import { User } from '../../../src/models/users/user.model.js';
import { createUserRepository } from '../../../src/repositories/users/user.repository.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const HASH = '$2b$04$fakehashfakehashfakehashfakehashfakehashfakehashfak';

function buildUser(overrides = {}) {
  return {
    username: 'sara.k',
    email: 'sara@isamm.uma.tn',
    password: HASH,
    isEmailVerified: true,
    ...overrides,
  };
}

describe('user repository, updateProfile', () => {
  const repository = createUserRepository();

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('updates the given fields and returns the updated user', async () => {
    const created = await repository.create(buildUser());

    const updated = await repository.updateProfile(created._id, {
      username: 'sara.k2',
      phone: '+21655000000',
    });

    expect(updated.username).toBe('sara.k2');
    expect(updated.phone).toBe('+21655000000');
    expect((await User.findById(created._id)).username).toBe('sara.k2');
  });

  it('changes an email and the verified flag together', async () => {
    const created = await repository.create(buildUser());

    const updated = await repository.updateProfile(created._id, {
      email: 'new@isamm.uma.tn',
      isEmailVerified: false,
    });

    expect(updated.email).toBe('new@isamm.uma.tn');
    expect(updated.isEmailVerified).toBe(false);
  });

  it('can set the phone number to null', async () => {
    const created = await repository.create(buildUser({ phone: '+21655000000' }));

    const updated = await repository.updateProfile(created._id, { phone: null });

    expect(updated.phone).toBeNull();
  });

  it('leaves every other field alone, and never loads the password hash', async () => {
    const created = await repository.create(buildUser());

    const updated = await repository.updateProfile(created._id, { username: 'sara.k2' });

    expect(updated.email).toBe('sara@isamm.uma.tn');
    expect(updated.role).toBe('user');
    expect(updated.isActive).toBe(true);
    expect(updated.password).toBeUndefined();
    expect((await User.findById(created._id).select('+password')).password).toBe(HASH);
  });

  it('lets a user change the casing of their own username', async () => {
    const created = await repository.create(buildUser({ username: 'sara.k' }));

    const updated = await repository.updateProfile(created._id, { username: 'Sara.K' });

    expect(updated.username).toBe('Sara.K');
  });

  it('turns a duplicate email into a ConflictError naming the field, and changes nothing', async () => {
    const created = await repository.create(buildUser());
    await repository.create(buildUser({ username: 'omar.b', email: 'omar@isamm.uma.tn' }));

    const error = await repository
      .updateProfile(created._id, { username: 'sara.k2', email: 'omar@isamm.uma.tn' })
      .catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual([{ field: 'email', message: 'Email is already used' }]);
    const stored = await User.findById(created._id);
    expect(stored.username).toBe('sara.k');
    expect(stored.email).toBe('sara@isamm.uma.tn');
  });

  it('turns a duplicate username into a ConflictError, ignoring case', async () => {
    const created = await repository.create(buildUser());
    await repository.create(buildUser({ username: 'Omar.B', email: 'omar@isamm.uma.tn' }));

    const error = await repository
      .updateProfile(created._id, { username: 'omar.b' })
      .catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual([{ field: 'username', message: 'Username is already taken' }]);
  });

  it('runs the model validators on an update', async () => {
    const created = await repository.create(buildUser());

    await expect(repository.updateProfile(created._id, { username: 'ab' })).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('returns null for an unknown id', async () => {
    const result = await repository.updateProfile(new mongoose.Types.ObjectId(), {
      username: 'nobody',
    });

    expect(result).toBeNull();
  });
});
