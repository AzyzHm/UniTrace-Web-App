import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../src/models/users/user.model.js';
import { createUserRepository } from '../../../src/repositories/users/user.repository.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const HASH = '$2b$04$fakehashfakehashfakehashfakehashfakehashfakehashfak';
const DELETED_AT = new Date('2026-10-20T10:00:00Z');

const placeholders = (user) => ({
  username: `deleted_user_${user._id}`,
  email: `deleted_${user._id}@deleted.invalid`,
  deletedAt: DELETED_AT,
});

describe('user repository, anonymize', () => {
  const repository = createUserRepository();

  const create = (overrides = {}) =>
    repository.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      phone: '+21655000000',
      password: HASH,
      isEmailVerified: true,
      ...overrides,
    });

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('removes everything that identifies the person', async () => {
    const user = await create();

    const result = await repository.anonymize(user._id, placeholders(user));

    expect(result.username).toBe(`deleted_user_${user._id}`);
    expect(result.email).toBe(`deleted_${user._id}@deleted.invalid`);
    expect(result.phone).toBeNull();
    expect(result.isEmailVerified).toBe(false);
    expect(result.deletedAt).toEqual(DELETED_AT);

    const stored = await User.findById(user._id).select('+password');
    expect(stored.password).toBe('!');
    expect(JSON.stringify(stored)).not.toMatch(/sara|21655000000|\$2[aby]\$/);
  });

  it('stores a username longer than the model allows for a real one', async () => {
    const user = await create();

    const result = await repository.anonymize(user._id, placeholders(user));

    expect(result.username.length).toBeGreaterThan(30);
  });

  it('keeps the role, the creation date and the id', async () => {
    const user = await create();

    const result = await repository.anonymize(user._id, placeholders(user));

    expect(String(result._id)).toBe(String(user._id));
    expect(result.role).toBe('user');
    expect(result.createdAt).toEqual(user.createdAt);
  });

  it('returns null for an account that is already deleted, and leaves it as it was', async () => {
    const user = await create();
    await repository.anonymize(user._id, placeholders(user));

    const second = await repository.anonymize(user._id, {
      ...placeholders(user),
      deletedAt: new Date('2027-01-01T00:00:00Z'),
    });

    expect(second).toBeNull();
    expect((await User.findById(user._id)).deletedAt).toEqual(DELETED_AT);
  });

  it('returns null for an unknown id', async () => {
    const id = new mongoose.Types.ObjectId();

    expect(await repository.anonymize(id, placeholders({ _id: id }))).toBeNull();
  });

  it('can delete several accounts, because every placeholder is unique', async () => {
    const sara = await create();
    const omar = await create({ username: 'omar.b', email: 'omar@isamm.uma.tn', phone: null });

    await repository.anonymize(sara._id, placeholders(sara));
    await repository.anonymize(omar._id, placeholders(omar));

    expect(await User.countDocuments({ deletedAt: { $ne: null } })).toBe(2);
  });

  it('frees the old username and email for a new account', async () => {
    const user = await create();
    await repository.anonymize(user._id, placeholders(user));

    const again = await create();

    expect(again.email).toBe('sara@isamm.uma.tn');
    expect(String(again._id)).not.toBe(String(user._id));
  });

  it('leaves other users alone', async () => {
    const sara = await create();
    const omar = await create({ username: 'omar.b', email: 'omar@isamm.uma.tn', phone: null });

    await repository.anonymize(sara._id, placeholders(sara));

    const untouched = await User.findById(omar._id);
    expect(untouched.username).toBe('omar.b');
    expect(untouched.deletedAt).toBeNull();
  });
});
