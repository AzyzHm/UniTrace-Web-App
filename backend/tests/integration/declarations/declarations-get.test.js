import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/declarations';
const PASSWORD = 'Secret123';
const PRIVATE_TEXT = 'Physics notebook with my name on page 1';

describe('GET /api/v1/declarations/:id', () => {
  let ctx;
  let sara;
  let omar;
  let admin;
  let saraToken;
  let omarToken;
  let adminToken;

  const get = (id, header = `Bearer ${omarToken}`) => {
    const req = request(ctx.app).get(`${URL}/${id}`);
    return header ? req.set('Authorization', header) : req;
  };

  const declare = (owner, overrides = {}) =>
    Declaration.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library, 2nd floor',
      category: 'wallet_bag',
      attributes: { brand: 'Nike', color: 'black' },
      privateInfo: PRIVATE_TEXT,
      owner: owner._id,
      ...overrides,
    });

  const createUser = async (username, extra = {}) =>
    User.create({
      username,
      email: `${username}@isamm.uma.tn`,
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
      ...extra,
    });

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await Declaration.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    sara = await createUser('sara.k');
    omar = await createUser('omar.b');
    admin = await createUser('admin', { role: 'admin' });
    saraToken = ctx.tokenService.signAccessToken(sara);
    omarToken = ctx.tokenService.signAccessToken(omar);
    adminToken = ctx.tokenService.signAccessToken(admin);
  });

  describe('access', () => {
    it('answers 401 without a token', async () => {
      const stored = await declare(sara);

      const res = await get(stored._id, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 with a token that is not valid', async () => {
      const stored = await declare(sara);

      const res = await get(stored._id, 'Bearer not-a-token');

      expect(res.status).toBe(401);
    });

    it('answers 403 for a suspended user', async () => {
      const stored = await declare(sara);
      await User.updateOne({ _id: omar._id }, { isActive: false });

      const res = await get(stored._id);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('answers 401 before it validates the id', async () => {
      const res = await get('not-an-id', null);

      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    it.each([
      ['a word', 'abc'],
      ['24 characters that are not hexadecimal', 'z'.repeat(24)],
      ['23 hexadecimal characters', 'a'.repeat(23)],
      ['25 hexadecimal characters', 'a'.repeat(25)],
      ['12 characters, which Mongoose would cast', 'abcdefghijkl'],
    ])('answers 400, not 500, for an id that is %s', async (_label, id) => {
      const res = await get(id);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'id', message: 'id must be a valid declaration id' },
      ]);
    });
  });

  describe('a declaration that does not exist', () => {
    it('answers 404 for a well formed id nobody owns', async () => {
      const res = await get(new mongoose.Types.ObjectId());

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it.each([
      ['its owner', () => saraToken],
      ['a stranger', () => omarToken],
      ['an admin', () => adminToken],
    ])('answers 404 for a deleted declaration, even to %s', async (_who, token) => {
      const stored = await declare(sara, { status: 'deleted', deletedAt: new Date() });

      const res = await get(stored._id, `Bearer ${token()}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('gives the same body for a missing, a deleted and a hidden declaration', async () => {
      const deleted = await declare(sara, { status: 'deleted', deletedAt: new Date() });
      const hidden = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const [missing, gone, secret] = await Promise.all([
        get(new mongoose.Types.ObjectId()),
        get(deleted._id),
        get(hidden._id),
      ]);

      expect(gone.status).toBe(404);
      expect(secret.status).toBe(404);
      expect(gone.body).toEqual(missing.body);
      expect(secret.body).toEqual(missing.body);
    });
  });

  describe('a stranger reads the public split', () => {
    it('answers 200 with exactly the public fields', async () => {
      const stored = await declare(sara);

      const res = await get(stored._id);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'allowedTransitions',
        'declaration',
        'isOwner',
        'ownerDeleted',
      ]);
      expect(Object.keys(res.body.declaration).sort()).toEqual([
        'attributes',
        'category',
        'createdAt',
        'date',
        'description',
        'id',
        'location',
        'picture',
        'status',
        'title',
        'type',
      ]);
      expect(res.body.declaration).toMatchObject({
        id: String(stored._id),
        title: 'Black backpack',
        type: 'lost',
        description: 'Black Nike backpack with a red keychain.',
        category: 'wallet_bag',
        attributes: { brand: 'Nike', color: 'black' },
        picture: null,
        status: 'pending',
        location: 'Main library, 2nd floor',
      });
      expect(new Date(res.body.declaration.date).toISOString()).toBe('2026-10-12T00:00:00.000Z');
      expect(res.body.isOwner).toBe(false);
      expect(res.body.ownerDeleted).toBe(false);
    });

    it('never returns the private info, the owner or the internal fields', async () => {
      const stored = await declare(sara, { status: 'matched' });

      const res = await get(stored._id);
      const text = JSON.stringify(res.body);

      for (const hidden of [
        'privateInfo',
        'owner',
        'statusBeforeHidden',
        'deletedAt',
        'updatedAt',
        '_id',
        '__v',
      ]) {
        expect(Object.keys(res.body.declaration)).not.toContain(hidden);
      }
      expect(text).not.toContain('name on page 1');
      expect(text).not.toContain(String(sara._id));
      expect(text).not.toContain('sara.k');
    });

    it.each(['pending', 'matched', 'resolved', 'expired'])(
      'reads a %s declaration with its status',
      async (status) => {
        const stored = await declare(sara, { status });

        const res = await get(stored._id);

        expect(res.status).toBe(200);
        expect(res.body.declaration.status).toBe(status);
      },
    );

    it('answers 404, not 403, for a hidden declaration', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const res = await get(stored._id);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('gives the URL of the picture of an ordinary category, not the file name', async () => {
      const stored = await declare(sara, { picture: `${'a'.repeat(32)}.webp` });

      const res = await get(stored._id);

      expect(res.body.declaration.picture).toBe(`${URL}/${stored._id}/picture`);
      expect(JSON.stringify(res.body)).not.toContain('.webp');
    });

    it('hides the picture of a student card', async () => {
      const stored = await declare(sara, {
        category: 'student_card_id',
        picture: `${'b'.repeat(32)}.webp`,
      });

      const res = await get(stored._id);

      expect(res.status).toBe(200);
      expect(res.body.declaration.picture).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('.webp');
      expect(JSON.stringify(res.body)).not.toContain('/picture');
    });
  });

  describe('the owner reads the full view', () => {
    it('answers 200 with the private info and the update date', async () => {
      const stored = await declare(sara);

      const res = await get(stored._id, `Bearer ${saraToken}`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.declaration).sort()).toEqual([
        'attributes',
        'category',
        'createdAt',
        'date',
        'description',
        'id',
        'location',
        'picture',
        'privateInfo',
        'status',
        'title',
        'type',
        'updatedAt',
      ]);
      expect(res.body.declaration.privateInfo).toBe(PRIVATE_TEXT);
      expect(res.body.isOwner).toBe(true);
      expect(res.body.ownerDeleted).toBe(false);
    });

    it('never returns the owner id or the internal fields to the owner either', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'matched' });

      const res = await get(stored._id, `Bearer ${saraToken}`);

      for (const hidden of ['owner', 'statusBeforeHidden', 'deletedAt', '_id', '__v']) {
        expect(Object.keys(res.body.declaration)).not.toContain(hidden);
      }
    });

    it('still reads a hidden declaration and sees that it is hidden', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const res = await get(stored._id, `Bearer ${saraToken}`);

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe('hidden');
    });

    it('keeps the picture of a student card', async () => {
      const stored = await declare(sara, {
        category: 'student_card_id',
        picture: `${'b'.repeat(32)}.webp`,
      });

      const res = await get(stored._id, `Bearer ${saraToken}`);

      expect(res.body.declaration.picture).toBe(`${URL}/${stored._id}/picture`);
    });

    it('answers null for a private info that was never given', async () => {
      const stored = await declare(sara, { privateInfo: undefined });

      const res = await get(stored._id, `Bearer ${saraToken}`);

      expect(res.body.declaration.privateInfo).toBeNull();
    });
  });

  describe('an admin', () => {
    it('reads the private info of a declaration that is not theirs', async () => {
      const stored = await declare(sara);

      const res = await get(stored._id, `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.declaration.privateInfo).toBe(PRIVATE_TEXT);
      expect(res.body.isOwner).toBe(false);
    });

    it('reads a hidden declaration', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const res = await get(stored._id, `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe('hidden');
    });

    it('does not get the owner identity either', async () => {
      const stored = await declare(sara);

      const res = await get(stored._id, `Bearer ${adminToken}`);
      const text = JSON.stringify(res.body);

      expect(text).not.toContain(String(sara._id));
      expect(text).not.toContain('sara.k');
    });
  });

  describe('when the owner deleted their account', () => {
    const deleteAccount = (user) =>
      User.updateOne({ _id: user._id }, { $set: { deletedAt: new Date() } });

    it('tells a stranger with ownerDeleted, and nothing about who it was', async () => {
      const stored = await declare(sara, { status: 'resolved', privateInfo: null });
      await deleteAccount(sara);

      const res = await get(stored._id);

      expect(res.status).toBe(200);
      expect(res.body.ownerDeleted).toBe(true);
      expect(res.body.isOwner).toBe(false);
      expect(res.body.declaration.status).toBe('resolved');
      expect(JSON.stringify(res.body)).not.toContain(String(sara._id));
    });

    it('tells an admin too', async () => {
      const stored = await declare(sara, { status: 'matched', privateInfo: null });
      await deleteAccount(sara);

      const res = await get(stored._id, `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ownerDeleted).toBe(true);
    });

    it('still hides a hidden declaration from a stranger', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });
      await deleteAccount(sara);

      const res = await get(stored._id);

      expect(res.status).toBe(404);
    });

    it('does not mark the declarations of a live owner', async () => {
      const stored = await declare(omar, { status: 'matched' });
      await deleteAccount(sara);

      const res = await get(stored._id, `Bearer ${adminToken}`);

      expect(res.body.ownerDeleted).toBe(false);
    });
  });

  describe('allowedTransitions', () => {
    const allowedFor = async (token, declaration) => {
      const res = await get(declaration._id, `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body.allowedTransitions;
    };

    const changeStatus = (id, token, status) =>
      request(ctx.app)
        .patch(`${URL}/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status });

    it.each(['pending', 'matched', 'resolved', 'expired'])(
      'is empty for a stranger on a %s declaration',
      async (status) => {
        const stored = await declare(sara, { status });

        expect(await allowedFor(omarToken, stored)).toEqual([]);
      },
    );

    it.each([
      ['pending', ['resolved', 'deleted']],
      ['matched', ['resolved', 'deleted']],
      ['resolved', []],
      ['expired', ['pending', 'deleted']],
    ])('gives the owner of a %s declaration %j', async (status, expected) => {
      const stored = await declare(sara, { status });

      expect(await allowedFor(saraToken, stored)).toEqual(expected);
    });

    it('gives the owner nothing on a hidden declaration', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      expect(await allowedFor(saraToken, stored)).toEqual([]);
    });

    it.each([
      ['pending', ['resolved', 'hidden', 'deleted']],
      ['resolved', ['pending', 'hidden', 'deleted']],
    ])('gives an admin on a %s declaration %j', async (status, expected) => {
      const stored = await declare(sara, { status });

      expect(await allowedFor(adminToken, stored)).toEqual(expected);
    });

    it('lets an admin restore a hidden declaration only where it came from, or delete it', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'matched' });

      expect(await allowedFor(adminToken, stored)).toEqual(['matched', 'deleted']);
    });

    it('follows a real hide: the list changes with the status', async () => {
      const stored = await declare(sara);

      expect((await changeStatus(stored._id, adminToken, 'hidden')).status).toBe(200);

      expect(await allowedFor(adminToken, stored)).toEqual(['pending', 'deleted']);
      expect(await allowedFor(saraToken, stored)).toEqual([]);
    });

    it('lists only moves that the status route then accepts', async () => {
      const stored = await declare(sara);

      const listed = await allowedFor(saraToken, stored);
      expect(listed.length).toBeGreaterThan(0);

      const res = await changeStatus(stored._id, saraToken, listed[0]);

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe(listed[0]);
    });

    it('never lists a move that the status route refuses', async () => {
      const stored = await declare(sara);

      const listed = await allowedFor(saraToken, stored);
      const refused = ['pending', 'matched', 'resolved', 'expired', 'hidden', 'deleted'].filter(
        (status) => !listed.includes(status),
      );

      for (const status of refused) {
        const res = await changeStatus(stored._id, saraToken, status);
        expect([403, 409]).toContain(res.status);
      }
      const after = await Declaration.findById(stored._id).lean();
      expect(after.status).toBe('pending');
    });
  });

  describe('routing', () => {
    it('still reads /mine as the list route, not as an id', async () => {
      const res = await get('mine', `Bearer ${saraToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('declarations');
    });

    it('does not change the declaration it reads', async () => {
      const stored = await declare(sara);
      const before = await Declaration.findById(stored._id).select('+privateInfo').lean();

      await get(stored._id);
      await get(stored._id, `Bearer ${saraToken}`);

      const after = await Declaration.findById(stored._id).select('+privateInfo').lean();
      expect(after).toEqual(before);
    });
  });
});
