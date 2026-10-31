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

describe('PATCH /api/v1/declarations/:id/status', () => {
  let ctx;
  let sara;
  let omar;
  let admin;
  let saraToken;
  let omarToken;
  let adminToken;
  let events;
  let off;

  const changeStatus = (id, body, header = `Bearer ${saraToken}`) => {
    const req = request(ctx.app).patch(`${URL}/${id}/status`).send(body);
    return header ? req.set('Authorization', header) : req;
  };

  const as = (token) => `Bearer ${token}`;

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

      const res = await changeStatus(stored._id, { status: 'resolved' }, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect((await reload(stored._id)).status).toBe('pending');
    });

    it('answers 401 with a token that is not valid', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, { status: 'resolved' }, 'Bearer not-a-token');

      expect(res.status).toBe(401);
    });

    it('answers 403 for a suspended user, and changes nothing', async () => {
      const stored = await declare(sara);
      await User.updateOne({ _id: sara._id }, { isActive: false });

      const res = await changeStatus(stored._id, { status: 'resolved' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await reload(stored._id)).status).toBe('pending');
      expect(events).toEqual([]);
    });
  });

  describe('validation', () => {
    it.each([
      ['a word', 'abc'],
      ['24 characters that are not hexadecimal', 'z'.repeat(24)],
      ['12 characters, which Mongoose would cast', 'abcdefghijkl'],
    ])('answers 400, not 500, for an id that is %s', async (_label, id) => {
      const res = await changeStatus(id, { status: 'resolved' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'id', message: 'id must be a valid declaration id' },
      ]);
    });

    it('answers 400 for a missing status', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, {});

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'status', message: 'status is required' }]);
    });

    it.each([['archived'], ['Resolved'], [''], [null], [1], [['resolved']], [{ $ne: 'x' }]])(
      'answers 400 for the status %j, and changes nothing',
      async (status) => {
        const stored = await declare(sara);

        const res = await changeStatus(stored._id, { status });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.every((d) => d.field === 'status')).toBe(true);
        expect((await reload(stored._id)).status).toBe('pending');
        expect(events).toEqual([]);
      },
    );

    it.each([
      ['owner', '507f1f77bcf86cd799439011'],
      ['deletedAt', '2026-10-20'],
      ['statusBeforeHidden', 'matched'],
      ['privateInfo', 'changed'],
      ['title', 'Blue backpack'],
    ])('answers 400 for %s in the body, and changes nothing', async (field, value) => {
      const stored = await declare(sara);
      const before = await reload(stored._id);

      const res = await changeStatus(stored._id, { status: 'resolved', [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field, message: `${field} is not allowed` }]);
      expect(await reload(stored._id)).toEqual(before);
      expect(events).toEqual([]);
    });

    it('validates the body of a declaration that does not exist before looking for it', async () => {
      const res = await changeStatus(new mongoose.Types.ObjectId(), { status: 'archived' });

      expect(res.status).toBe(400);
    });
  });

  describe('a declaration that does not exist', () => {
    it('answers 404 for a well formed id nobody owns', async () => {
      const res = await changeStatus(new mongoose.Types.ObjectId(), { status: 'resolved' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it.each([
      ['its owner', () => saraToken],
      ['a stranger', () => omarToken],
      ['an admin', () => adminToken],
    ])('answers 404 for a deleted declaration, even to %s', async (_who, token) => {
      const stored = await declare(sara, { status: 'deleted', deletedAt: new Date() });

      const res = await changeStatus(stored._id, { status: 'pending' }, as(token()));

      expect(res.status).toBe(404);
      expect((await reload(stored._id)).status).toBe('deleted');
      expect(events).toEqual([]);
    });

    it('gives the same body for a missing, a deleted and a hidden declaration, to a stranger', async () => {
      const deleted = await declare(sara, { status: 'deleted', deletedAt: new Date() });
      const hidden = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const [missing, gone, secret] = await Promise.all([
        changeStatus(new mongoose.Types.ObjectId(), { status: 'pending' }, as(omarToken)),
        changeStatus(deleted._id, { status: 'pending' }, as(omarToken)),
        changeStatus(hidden._id, { status: 'pending' }, as(omarToken)),
      ]);

      expect(gone.status).toBe(404);
      expect(secret.status).toBe(404);
      expect(gone.body).toEqual(missing.body);
      expect(secret.body).toEqual(missing.body);
      expect((await reload(hidden._id)).status).toBe('hidden');
    });
  });

  describe('a stranger', () => {
    it.each(['pending', 'matched', 'resolved', 'expired'])(
      'answers 403 on a %s declaration, and changes nothing',
      async (status) => {
        const stored = await declare(sara, { status });

        const res = await changeStatus(stored._id, { status: 'deleted' }, as(omarToken));

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect((await reload(stored._id)).status).toBe(status);
        expect(events).toEqual([]);
      },
    );
  });

  describe('the owner', () => {
    it('marks a pending declaration as resolved and gets the full view back', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, { status: 'resolved' });

      expect(res.status).toBe(200);
      expect(res.body.declaration.id).toBe(String(stored._id));
      expect(res.body.declaration.status).toBe('resolved');
      expect(res.body.declaration.privateInfo).toBe(PRIVATE_TEXT);
      expect(res.body.declaration.title).toBe('Black backpack');
      expect(await reload(stored._id)).toMatchObject({
        status: 'resolved',
        statusBeforeHidden: null,
        deletedAt: null,
        privateInfo: PRIVATE_TEXT,
      });
    });

    it('never sees the internal fields in the answer', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, { status: 'resolved' });

      expect(res.body.declaration).not.toHaveProperty('statusBeforeHidden');
      expect(res.body.declaration).not.toHaveProperty('deletedAt');
      expect(res.body.declaration).not.toHaveProperty('owner');
    });

    it.each([
      ['matched', 'resolved'],
      ['expired', 'pending'],
    ])('moves a %s declaration to %s', async (from, to) => {
      const stored = await declare(sara, { status: from });

      const res = await changeStatus(stored._id, { status: to });

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe(to);
      expect((await reload(stored._id)).status).toBe(to);
    });

    it('refreshes updatedAt but leaves every other field alone', async () => {
      const stored = await declare(sara);
      const before = await reload(stored._id);

      await changeStatus(stored._id, { status: 'resolved' });

      const after = await reload(stored._id);
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
      expect({ ...after, status: 'x', updatedAt: null }).toEqual({
        ...before,
        status: 'x',
        updatedAt: null,
      });
    });

    it('deletes through the status route too, and loses the private detail', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, { status: 'deleted' });

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe('deleted');
      expect(res.body.declaration.privateInfo).toBeNull();
      const after = await reload(stored._id);
      expect(after.status).toBe('deleted');
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(after.privateInfo).toBeNull();
    });

    it('cannot see a deleted declaration afterwards', async () => {
      const stored = await declare(sara);
      await changeStatus(stored._id, { status: 'deleted' });

      const res = await request(ctx.app)
        .get(`${URL}/${stored._id}`)
        .set('Authorization', as(saraToken));

      expect(res.status).toBe(404);
    });

    it.each([
      ['pending', 'hidden'],
      ['matched', 'hidden'],
      ['resolved', 'pending'],
      ['resolved', 'hidden'],
      ['resolved', 'deleted'],
      ['hidden', 'pending'],
      ['hidden', 'deleted'],
    ])('answers 403 for %s to %s, which only an admin can do', async (from, to) => {
      const stored = await declare(sara, {
        status: from,
        statusBeforeHidden: from === 'hidden' ? 'pending' : null,
      });
      const before = await reload(stored._id);

      const res = await changeStatus(stored._id, { status: to });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toBe(
        `Only an admin can change a ${from} declaration to ${to}`,
      );
      expect(await reload(stored._id)).toEqual(before);
      expect(events).toEqual([]);
    });

    it.each([
      ['pending', 'matched'],
      ['pending', 'expired'],
      ['matched', 'pending'],
      ['expired', 'resolved'],
    ])('answers 409 for %s to %s, which only the system can do', async (from, to) => {
      const stored = await declare(sara, { status: from });

      const res = await changeStatus(stored._id, { status: to });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toBe(`A ${from} declaration cannot become ${to}`);
      expect((await reload(stored._id)).status).toBe(from);
      expect(events).toEqual([]);
    });

    it('answers 409 when the declaration already has that status', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, { status: 'pending' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('The declaration is already pending');
      expect(events).toEqual([]);
    });

    it('answers 409 the second time the same move is sent', async () => {
      const stored = await declare(sara);

      const first = await changeStatus(stored._id, { status: 'resolved' });
      const second = await changeStatus(stored._id, { status: 'resolved' });

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(events).toHaveLength(1);
    });

    it('can still read a hidden declaration, but not restore it', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const read = await request(ctx.app)
        .get(`${URL}/${stored._id}`)
        .set('Authorization', as(saraToken));
      const restore = await changeStatus(stored._id, { status: 'pending' });

      expect(read.status).toBe(200);
      expect(restore.status).toBe(403);
    });
  });

  describe('an admin', () => {
    it.each([
      ['pending', 'resolved'],
      ['pending', 'deleted'],
      ['matched', 'resolved'],
      ['resolved', 'pending'],
      ['resolved', 'deleted'],
      ['expired', 'pending'],
    ])('moves a %s declaration they do not own to %s', async (from, to) => {
      const stored = await declare(sara, { status: from });

      const res = await changeStatus(stored._id, { status: to }, as(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe(to);
      expect((await reload(stored._id)).status).toBe(to);
    });

    it.each([
      ['pending', 'matched'],
      ['pending', 'expired'],
      ['matched', 'pending'],
      ['resolved', 'expired'],
    ])('still gets 409 for %s to %s: only the system sets those', async (from, to) => {
      const stored = await declare(sara, { status: from });

      const res = await changeStatus(stored._id, { status: to }, as(adminToken));

      expect(res.status).toBe(409);
      expect((await reload(stored._id)).status).toBe(from);
    });

    it('gets the private detail back, as the owner does', async () => {
      const stored = await declare(sara);

      const res = await changeStatus(stored._id, { status: 'resolved' }, as(adminToken));

      expect(res.body.declaration.privateInfo).toBe(PRIVATE_TEXT);
    });

    it('deletes a resolved declaration, which its owner cannot', async () => {
      const stored = await declare(sara, { status: 'resolved' });

      const res = await changeStatus(stored._id, { status: 'deleted' }, as(adminToken));

      expect(res.status).toBe(200);
      const after = await reload(stored._id);
      expect(after.status).toBe('deleted');
      expect(after.privateInfo).toBeNull();
    });
  });

  describe('hiding and restoring', () => {
    it.each(['pending', 'matched', 'resolved'])(
      'hides a %s declaration and remembers the status it had',
      async (from) => {
        const stored = await declare(sara, { status: from });

        const res = await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));

        expect(res.status).toBe(200);
        expect(res.body.declaration.status).toBe('hidden');
        expect(res.body.declaration).not.toHaveProperty('statusBeforeHidden');
        expect(await reload(stored._id)).toMatchObject({
          status: 'hidden',
          statusBeforeHidden: from,
        });
      },
    );

    it('makes a hidden declaration invisible to strangers and still readable by its owner and admins', async () => {
      const stored = await declare(sara);
      await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));
      const read = (token) =>
        request(ctx.app).get(`${URL}/${stored._id}`).set('Authorization', as(token));

      const [stranger, owner, asAdmin] = await Promise.all([
        read(omarToken),
        read(saraToken),
        read(adminToken),
      ]);

      expect(stranger.status).toBe(404);
      expect(owner.status).toBe(200);
      expect(asAdmin.status).toBe(200);
    });

    it.each(['pending', 'matched', 'resolved'])(
      'restores a hidden declaration to %s and forgets where it came from',
      async (before) => {
        const stored = await declare(sara, { status: before });
        await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));
        events.length = 0;

        const res = await changeStatus(stored._id, { status: before }, as(adminToken));

        expect(res.status).toBe(200);
        expect(res.body.declaration.status).toBe(before);
        expect(await reload(stored._id)).toMatchObject({
          status: before,
          statusBeforeHidden: null,
        });
        expect(events).toEqual([
          {
            declarationId: String(stored._id),
            ownerId: String(sara._id),
            from: 'hidden',
            to: before,
            actor: 'admin',
          },
        ]);
      },
    );

    it('refuses to restore a hidden declaration anywhere but where it came from', async () => {
      const stored = await declare(sara, { status: 'resolved' });
      await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));
      events.length = 0;

      const res = await changeStatus(stored._id, { status: 'pending' }, as(adminToken));

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('A hidden declaration can only be restored to resolved');
      expect(await reload(stored._id)).toMatchObject({
        status: 'hidden',
        statusBeforeHidden: 'resolved',
      });
      expect(events).toEqual([]);
    });

    it('deletes a hidden declaration whatever it was before, and forgets the old status', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'matched' });

      const res = await changeStatus(stored._id, { status: 'deleted' }, as(adminToken));

      expect(res.status).toBe(200);
      expect(await reload(stored._id)).toMatchObject({
        status: 'deleted',
        statusBeforeHidden: null,
        privateInfo: null,
      });
    });

    it('can hide again after a restore, and remembers the new status', async () => {
      const stored = await declare(sara);
      await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));
      await changeStatus(stored._id, { status: 'pending' }, as(adminToken));
      await changeStatus(stored._id, { status: 'resolved' }, as(saraToken));

      const res = await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));

      expect(res.status).toBe(200);
      expect(await reload(stored._id)).toMatchObject({
        status: 'hidden',
        statusBeforeHidden: 'resolved',
      });
    });

    it('lets a stranger restore nothing: a hidden declaration does not exist for them', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const res = await changeStatus(stored._id, { status: 'pending' }, as(omarToken));

      expect(res.status).toBe(404);
    });
  });

  describe('the event', () => {
    it('is announced once, with the role of the actor and the owner of the declaration', async () => {
      const stored = await declare(sara);

      await changeStatus(stored._id, { status: 'resolved' });

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          from: 'pending',
          to: 'resolved',
          actor: 'user',
        },
      ]);
    });

    it('names the owner, not the admin, when an admin moves it', async () => {
      const stored = await declare(sara);

      await changeStatus(stored._id, { status: 'hidden' }, as(adminToken));

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          from: 'pending',
          to: 'hidden',
          actor: 'admin',
        },
      ]);
    });

    it('still succeeds when a listener fails', async () => {
      const stored = await declare(sara);
      const offBroken = ctx.eventBus.on('declaration.statusChanged', () => {
        throw new Error('listener down');
      });

      const res = await changeStatus(stored._id, { status: 'resolved' });
      offBroken();

      expect(res.status).toBe(200);
      expect((await reload(stored._id)).status).toBe('resolved');
    });
  });

  describe('the lists', () => {
    it('shows the new status in my declarations', async () => {
      const stored = await declare(sara);
      await changeStatus(stored._id, { status: 'resolved' });

      const res = await request(ctx.app)
        .get(`${URL}/mine`)
        .query({ status: 'resolved' })
        .set('Authorization', as(saraToken));

      expect(res.status).toBe(200);
      expect(res.body.declarations.map((d) => d.id)).toEqual([String(stored._id)]);
    });

    it('drops a deleted declaration from my declarations', async () => {
      const stored = await declare(sara);
      await changeStatus(stored._id, { status: 'deleted' });

      const res = await request(ctx.app).get(`${URL}/mine`).set('Authorization', as(saraToken));

      expect(res.body.declarations).toEqual([]);
    });
  });
});
