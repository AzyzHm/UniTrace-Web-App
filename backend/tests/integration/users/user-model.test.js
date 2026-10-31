import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../src/models/users/user.model.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

function buildUser(overrides = {}) {
  return {
    username: 'sara.k',
    email: 'sara@isamm.uma.tn',
    password: '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfak',
    ...overrides,
  };
}

describe('User model', () => {
  beforeAll(async () => {
    await connectTestDb();
    await User.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it('applies safe defaults', async () => {
    const user = await User.create(buildUser());

    expect(user.role).toBe('user');
    expect(user.isActive).toBe(true);
    expect(user.isEmailVerified).toBe(false);
    expect(user.deletedAt).toBeNull();
    expect(user.phone).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('trims and lowercases the email', async () => {
    const user = await User.create(buildUser({ email: '  Sara@ISAMM.uma.tn ' }));

    expect(user.email).toBe('sara@isamm.uma.tn');
  });

  it('requires username, email and password', async () => {
    await expect(User.create({})).rejects.toMatchObject({
      name: 'ValidationError',
      errors: {
        username: expect.anything(),
        email: expect.anything(),
        password: expect.anything(),
      },
    });
  });

  it('rejects a role outside the enum', async () => {
    await expect(User.create(buildUser({ role: 'superadmin' }))).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('rejects a duplicate email at the database level', async () => {
    await User.create(buildUser());

    await expect(User.create(buildUser({ username: 'other.user' }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('treats usernames as case-insensitive for uniqueness', async () => {
    await User.create(buildUser({ username: 'Sara.K' }));

    await expect(
      User.create(buildUser({ username: 'sara.k', email: 'other@isamm.uma.tn' })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('keeps the casing the user typed', async () => {
    const user = await User.create(buildUser({ username: 'Sara.K' }));

    expect(user.username).toBe('Sara.K');
  });

  it('hides the password hash from normal queries', async () => {
    const created = await User.create(buildUser());

    const found = await User.findById(created._id);

    expect(found.password).toBeUndefined();
  });

  it('returns the password hash only when explicitly requested', async () => {
    const created = await User.create(buildUser());

    const found = await User.findById(created._id).select('+password');

    expect(found.password).toBe(buildUser().password);
  });

  it('strips the password and __v when serialized to JSON', async () => {
    const created = await User.create(buildUser());
    const withPassword = await User.findById(created._id).select('+password');

    const json = JSON.parse(JSON.stringify(withPassword));

    expect(json.password).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.email).toBe('sara@isamm.uma.tn');
  });

  it('uses the shared mongoose connection of the test database', () => {
    expect(mongoose.connection.readyState).toBe(1);
  });
});
