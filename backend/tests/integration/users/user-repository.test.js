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
    ...overrides,
  };
}

describe('user repository', () => {
  const repository = createUserRepository();

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('creates a user', async () => {
    const user = await repository.create(buildUser());

    expect(user.id).toBeDefined();
    expect(user.email).toBe('sara@isamm.uma.tn');
  });

  it('turns a duplicate email into a ConflictError naming the field', async () => {
    await repository.create(buildUser());

    const error = await repository
      .create(buildUser({ username: 'other.user' }))
      .catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual([{ field: 'email', message: 'Email is already used' }]);
  });

  it('turns a duplicate username into a ConflictError, ignoring case', async () => {
    await repository.create(buildUser({ username: 'Sara.K' }));

    const error = await repository
      .create(buildUser({ username: 'sara.k', email: 'other@isamm.uma.tn' }))
      .catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual([{ field: 'username', message: 'Username is already taken' }]);
  });

  it('lets other errors through untouched', async () => {
    await expect(repository.create({})).rejects.toMatchObject({ name: 'ValidationError' });
  });

  describe('findById', () => {
    it('finds the user, without the password hash', async () => {
      const created = await repository.create(buildUser());

      const found = await repository.findById(created._id);

      expect(found.email).toBe('sara@isamm.uma.tn');
      expect(found.password).toBeUndefined();
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById(new mongoose.Types.ObjectId())).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('finds the user by email', async () => {
      const created = await repository.create(buildUser());

      const found = await repository.findByEmail('sara@isamm.uma.tn');

      expect(String(found._id)).toBe(String(created._id));
    });

    it('returns null for an unknown email', async () => {
      expect(await repository.findByEmail('nobody@isamm.uma.tn')).toBeNull();
    });

    it('does not load the password hash', async () => {
      await repository.create(buildUser());

      const found = await repository.findByEmail('sara@isamm.uma.tn');

      expect(found.password).toBeUndefined();
    });
  });

  describe('findByEmailWithPassword', () => {
    it('loads the password hash', async () => {
      await repository.create(buildUser());

      const found = await repository.findByEmailWithPassword('sara@isamm.uma.tn');

      expect(found.password).toBe(HASH);
    });

    it('returns null for an unknown email', async () => {
      expect(await repository.findByEmailWithPassword('nobody@isamm.uma.tn')).toBeNull();
    });
  });

  describe('markEmailVerified', () => {
    it('flips the flag and returns the updated user', async () => {
      const created = await repository.create(buildUser());

      const updated = await repository.markEmailVerified(created._id);

      expect(updated.isEmailVerified).toBe(true);
      expect((await User.findById(created._id)).isEmailVerified).toBe(true);
    });

    it('returns null when the user is already verified', async () => {
      const created = await repository.create(buildUser());
      await repository.markEmailVerified(created._id);

      expect(await repository.markEmailVerified(created._id)).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.markEmailVerified(new mongoose.Types.ObjectId())).toBeNull();
    });
  });

  describe('updatePassword', () => {
    it('replaces the stored hash', async () => {
      const created = await repository.create(buildUser());

      await repository.updatePassword(
        created._id,
        '$2b$04$anotherhashanotherhashanotherhashanotherhashanotherha',
      );

      const found = await repository.findByEmailWithPassword('sara@isamm.uma.tn');
      expect(found.password).toBe('$2b$04$anotherhashanotherhashanotherhashanotherhashanotherha');
    });

    it('changes nothing else about the user', async () => {
      const created = await repository.create(buildUser());

      const updated = await repository.updatePassword(created._id, 'new-hash');

      expect(updated.email).toBe('sara@isamm.uma.tn');
      expect(updated.username).toBe('sara.k');
      expect(updated.role).toBe('user');
      expect(updated.isEmailVerified).toBe(false);
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.updatePassword(new mongoose.Types.ObjectId(), 'new-hash')).toBeNull();
    });
  });
});
