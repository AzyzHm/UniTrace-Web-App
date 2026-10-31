import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/declarations';
const PASSWORD = 'Secret123';
const PRIVATE_TEXT = 'Physics notebook with my name on page 1';

describe('DELETE /api/v1/declarations/:id', () => {
  let ctx;
  let sara;
  let omar;
  let admin;
  let saraToken;
  let omarToken;
  let adminToken;
  let events;
  let off;

  const remove = (id, header = `Bearer ${saraToken}`) => {
    const req = request(ctx.app).delete(`${URL}/${id}`);
    return header ? req.set('Authorization', header) : req;
  };

  const as = (token) => `Bearer ${token}`;

  const read = (id, token) => request(ctx.app).get(`${URL}/${id}`).set('Authorization', as(token));

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

  const reload = (id) => Declaration.findById(id).select('+privateInfo').lean();

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

    events = [];
    off = ctx.eventBus.on('declaration.statusChanged', (payload) => events.push(payload));
  });

  afterEach(() => off());

  describe('access', () => {
    it('answers 401 without a token', async () => {
      const stored = await declare(sara);

      const res = await remove(stored._id, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect((await reload(stored._id)).status).toBe('pending');
    });

    it('answers 403 for a suspended user, and deletes nothing', async () => {
      const stored = await declare(sara);
      await User.updateOne({ _id: sara._id }, { isActive: false });

      const res = await remove(stored._id);

      expect(res.status).toBe(403);
      expect((await reload(stored._id)).status).toBe('pending');
      expect(events).toEqual([]);
    });

    it.each([
      ['a word', 'abc'],
      ['24 characters that are not hexadecimal', 'z'.repeat(24)],
      ['12 characters, which Mongoose would cast', 'abcdefghijkl'],
    ])('answers 400, not 500, for an id that is %s', async (_label, id) => {
      const res = await remove(id);

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'id', message: 'id must be a valid declaration id' },
      ]);
    });
  });

  describe('the owner', () => {
    it.each(['pending', 'matched', 'expired'])(
      'deletes a %s declaration and gets 204 with no body',
      async (status) => {
        const stored = await declare(sara, { status });

        const res = await remove(stored._id);

        expect(res.status).toBe(204);
        expect(res.body).toEqual({});
        expect(res.text).toBe('');
        expect((await reload(stored._id)).status).toBe('deleted');
      },
    );

    it('keeps the document but stamps deletedAt and erases the private detail', async () => {
      const stored = await declare(sara);
      const before = await reload(stored._id);

      await remove(stored._id);

      const after = await reload(stored._id);
      expect(after).not.toBeNull();
      expect(after.status).toBe('deleted');
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(after.privateInfo).toBeNull();
      // Everything else is kept, so the history is still there.
      expect({
        ...after,
        status: 'x',
        deletedAt: null,
        privateInfo: null,
        updatedAt: null,
      }).toEqual({
        ...before,
        status: 'x',
        deletedAt: null,
        privateInfo: null,
        updatedAt: null,
      });
    });

    it('makes the declaration disappear for everybody', async () => {
      const stored = await declare(sara);
      await remove(stored._id);

      const [owner, stranger, asAdmin] = await Promise.all([
        read(stored._id, saraToken),
        read(stored._id, omarToken),
        read(stored._id, adminToken),
      ]);

      expect(owner.status).toBe(404);
      expect(stranger.status).toBe(404);
      expect(asAdmin.status).toBe(404);
    });

    it('drops the declaration from my declarations', async () => {
      const kept = await declare(sara, { title: 'Blue umbrella' });
      const gone = await declare(sara);
      await remove(gone._id);

      const res = await request(ctx.app).get(`${URL}/mine`).set('Authorization', as(saraToken));

      expect(res.body.declarations.map((d) => d.id)).toEqual([String(kept._id)]);
    });

    it('answers 404 the second time, so deleting twice is safe', async () => {
      const stored = await declare(sara);

      const first = await remove(stored._id);
      const second = await remove(stored._id);

      expect(first.status).toBe(204);
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe('NOT_FOUND');
      expect(events).toHaveLength(1);
    });

    it('touches only the declaration it was asked to delete', async () => {
      const target = await declare(sara);
      const other = await declare(sara, { title: 'Blue umbrella' });
      const strangers = await declare(omar, { title: 'Green scarf' });

      await remove(target._id);

      expect((await reload(other._id)).status).toBe('pending');
      expect((await reload(other._id)).privateInfo).toBe(PRIVATE_TEXT);
      expect((await reload(strangers._id)).status).toBe('pending');
    });

    it.each(['resolved', 'hidden'])(
      'answers 403 for a %s declaration, which only an admin can delete',
      async (status) => {
        const stored = await declare(sara, {
          status,
          statusBeforeHidden: status === 'hidden' ? 'pending' : null,
        });
        const before = await reload(stored._id);

        const res = await remove(stored._id);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(await reload(stored._id)).toEqual(before);
        expect(events).toEqual([]);
      },
    );
  });

  describe('an admin', () => {
    it.each(['pending', 'matched', 'resolved', 'expired', 'hidden'])(
      'deletes a %s declaration they do not own',
      async (status) => {
        const stored = await declare(sara, {
          status,
          statusBeforeHidden: status === 'hidden' ? 'pending' : null,
        });

        const res = await remove(stored._id, as(adminToken));

        expect(res.status).toBe(204);
        expect(await reload(stored._id)).toMatchObject({
          status: 'deleted',
          statusBeforeHidden: null,
          privateInfo: null,
        });
      },
    );
  });

  describe('a stranger', () => {
    it.each(['pending', 'matched', 'resolved', 'expired'])(
      'answers 403 on a %s declaration, and deletes nothing',
      async (status) => {
        const stored = await declare(sara, { status });

        const res = await remove(stored._id, as(omarToken));

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(await reload(stored._id)).toMatchObject({
          status,
          privateInfo: PRIVATE_TEXT,
        });
        expect(events).toEqual([]);
      },
    );
  });

  describe('a declaration that does not exist', () => {
    it('answers 404 for a well formed id nobody owns', async () => {
      const res = await remove(new mongoose.Types.ObjectId());

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('gives a stranger the same body for a missing, a deleted and a hidden declaration', async () => {
      const deleted = await declare(sara, { status: 'deleted', deletedAt: new Date() });
      const hidden = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const [missing, gone, secret] = await Promise.all([
        remove(new mongoose.Types.ObjectId(), as(omarToken)),
        remove(deleted._id, as(omarToken)),
        remove(hidden._id, as(omarToken)),
      ]);

      expect(gone.status).toBe(404);
      expect(secret.status).toBe(404);
      expect(gone.body).toEqual(missing.body);
      expect(secret.body).toEqual(missing.body);
      expect((await reload(hidden._id)).status).toBe('hidden');
    });
  });

  describe('the event', () => {
    it('announces a move to deleted, with the owner as actor', async () => {
      const stored = await declare(sara);

      await remove(stored._id);

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          from: 'pending',
          to: 'deleted',
          actor: 'user',
        },
      ]);
    });

    it('names the owner, not the admin, when an admin deletes', async () => {
      const stored = await declare(sara, { status: 'resolved' });

      await remove(stored._id, as(adminToken));

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          from: 'resolved',
          to: 'deleted',
          actor: 'admin',
        },
      ]);
    });
  });
});
