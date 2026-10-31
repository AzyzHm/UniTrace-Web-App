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

describe('PATCH /api/v1/declarations/:id', () => {
  let ctx;
  let sara;
  let omar;
  let admin;
  let saraToken;
  let omarToken;
  let adminToken;
  let events;
  let off;

  const patch = (id, body, header = `Bearer ${saraToken}`) => {
    const req = request(ctx.app).patch(`${URL}/${id}`).send(body);
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
    off = ctx.eventBus.on('declaration.updated', (payload) => events.push(payload));
  });

  afterEach(() => off());

  describe('access', () => {
    it('answers 401 without a token', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { title: 'Blue backpack' }, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 with a token that is not valid', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { title: 'Blue backpack' }, 'Bearer not-a-token');

      expect(res.status).toBe(401);
    });

    it('answers 403 for a suspended user', async () => {
      const stored = await declare(sara);
      await User.updateOne({ _id: sara._id }, { isActive: false });

      const res = await patch(stored._id, { title: 'Blue backpack' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await reload(stored._id)).title).toBe('Black backpack');
    });

    it('answers 401 before it validates anything', async () => {
      const res = await patch('not-an-id', { status: 'resolved' }, null);

      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    it.each([
      ['a word', 'abc'],
      ['24 characters that are not hexadecimal', 'z'.repeat(24)],
      ['23 hexadecimal characters', 'a'.repeat(23)],
      ['12 characters, which Mongoose would cast', 'abcdefghijkl'],
    ])('answers 400, not 500, for an id that is %s', async (_label, id) => {
      const res = await patch(id, { title: 'Blue backpack' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'id', message: 'id must be a valid declaration id' },
      ]);
    });

    it('answers 400 for an empty body', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, {});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].message).toBe('At least one field to update is required');
    });

    it.each([
      ['type', 'found'],
      ['owner', '507f1f77bcf86cd799439011'],
      ['status', 'resolved'],
      ['picture', 'uploads/evil.png'],
      ['privateInfo', 'changed'],
      ['deletedAt', '2026-10-20'],
      ['statusBeforeHidden', 'matched'],
    ])('answers 400 for %s and changes nothing', async (field, value) => {
      const stored = await declare(sara);
      const before = await reload(stored._id);

      const res = await patch(stored._id, { title: 'Blue backpack', [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field, message: `${field} is not allowed` }]);
      expect(await reload(stored._id)).toEqual(before);
      expect(events).toEqual([]);
    });

    it('answers 400 with every bad field at once, and changes nothing', async () => {
      const stored = await declare(sara);
      const before = await reload(stored._id);

      const res = await patch(stored._id, {
        title: 'ab',
        category: 'spaceship',
        date: '2999-01-01',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field).sort()).toEqual([
        'category',
        'date',
        'title',
      ]);
      expect(await reload(stored._id)).toEqual(before);
    });

    it('validates the body of a declaration that does not exist before looking for it', async () => {
      const res = await patch(new mongoose.Types.ObjectId(), { title: 'ab' });

      expect(res.status).toBe(400);
    });
  });

  describe('a declaration that does not exist', () => {
    it('answers 404 for a well formed id nobody owns', async () => {
      const res = await patch(new mongoose.Types.ObjectId(), { title: 'Blue backpack' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it.each([
      ['its owner', () => saraToken],
      ['a stranger', () => omarToken],
      ['an admin', () => adminToken],
    ])('answers 404 for a deleted declaration, even to %s', async (_who, token) => {
      const stored = await declare(sara, { status: 'deleted', deletedAt: new Date() });

      const res = await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${token()}`);

      expect(res.status).toBe(404);
      expect((await reload(stored._id)).title).toBe('Black backpack');
    });

    it('gives the same body for a missing, a deleted and a hidden declaration, to a stranger', async () => {
      const deleted = await declare(sara, { status: 'deleted', deletedAt: new Date() });
      const hidden = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });
      const header = `Bearer ${omarToken}`;

      const [missing, gone, secret] = await Promise.all([
        patch(new mongoose.Types.ObjectId(), { title: 'Blue backpack' }, header),
        patch(deleted._id, { title: 'Blue backpack' }, header),
        patch(hidden._id, { title: 'Blue backpack' }, header),
      ]);

      expect(gone.status).toBe(404);
      expect(secret.status).toBe(404);
      expect(gone.body).toEqual(missing.body);
      expect(secret.body).toEqual(missing.body);
    });
  });

  describe('a stranger', () => {
    it('answers 403 on a declaration they can read, and changes nothing', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${omarToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await reload(stored._id)).title).toBe('Black backpack');
      expect(events).toEqual([]);
    });

    it.each(['matched', 'resolved', 'expired'])(
      'answers 403 on a %s declaration',
      async (status) => {
        const stored = await declare(sara, { status });

        const res = await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${omarToken}`);

        expect(res.status).toBe(403);
      },
    );
  });

  describe('the owner', () => {
    it.each(['pending', 'expired'])('edits a %s declaration', async (status) => {
      const stored = await declare(sara, { status });

      const res = await patch(stored._id, { title: 'Blue backpack' });

      expect(res.status).toBe(200);
      expect(res.body.declaration.title).toBe('Blue backpack');
      expect(res.body.declaration.status).toBe(status);
      expect((await reload(stored._id)).title).toBe('Blue backpack');
    });

    it.each(['matched', 'hidden', 'resolved'])(
      'is refused with 403 on a %s declaration, and nothing changes',
      async (status) => {
        const stored = await declare(sara, { status });
        const before = await reload(stored._id);

        const res = await patch(stored._id, { title: 'Blue backpack' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.message).toBe(`A ${status} declaration cannot be edited`);
        expect(await reload(stored._id)).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('changes every editable field at once', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, {
        title: '  Blue backpack ',
        description: 'Blue Nike backpack with a green keychain.',
        date: '2026-10-13',
        location: 'Cafeteria',
        category: 'keys',
        attributes: { color: 'blue' },
      });

      expect(res.status).toBe(200);
      const saved = await reload(stored._id);
      expect(saved.title).toBe('Blue backpack');
      expect(saved.description).toBe('Blue Nike backpack with a green keychain.');
      expect(saved.date.toISOString()).toBe('2026-10-13T00:00:00.000Z');
      expect(saved.location).toBe('Cafeteria');
      expect(saved.category).toBe('keys');
      expect(saved.attributes).toEqual({ color: 'blue' });
    });

    it('leaves every field it was not given as it was', async () => {
      const stored = await declare(sara);

      await patch(stored._id, { title: 'Blue backpack' });

      const saved = await reload(stored._id);
      expect(saved).toMatchObject({
        type: 'lost',
        status: 'pending',
        description: 'Black Nike backpack with a red keychain.',
        location: 'Main library, 2nd floor',
        category: 'wallet_bag',
        attributes: { brand: 'Nike', color: 'black' },
        privateInfo: PRIVATE_TEXT,
        picture: null,
        statusBeforeHidden: null,
        deletedAt: null,
      });
      expect(String(saved.owner)).toBe(String(sara._id));
    });

    it('replaces the attributes as a whole', async () => {
      const stored = await declare(sara);

      await patch(stored._id, { attributes: { color: 'blue' } });

      expect((await reload(stored._id)).attributes).toEqual({ color: 'blue' });
    });

    it('clears the attributes with an empty object', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { attributes: {} });

      expect(res.status).toBe(200);
      expect(res.body.declaration.attributes).toEqual({});
      expect((await reload(stored._id)).attributes).toEqual({});
    });

    it('refreshes updatedAt and keeps createdAt', async () => {
      const stored = await declare(sara);
      // An old updatedAt written straight in the collection, so the test does
      // not depend on two writes landing in different milliseconds.
      const old = new Date('2026-01-01T00:00:00Z');
      await Declaration.collection.updateOne({ _id: stored._id }, { $set: { updatedAt: old } });
      const before = await reload(stored._id);

      await patch(stored._id, { title: 'Blue backpack' });

      const after = await reload(stored._id);
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    });
  });

  describe('the response', () => {
    it('is the full owner view, with the private info and the new values', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { title: 'Blue backpack' });

      expect(Object.keys(res.body)).toEqual(['declaration']);
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
      expect(res.body.declaration).toMatchObject({
        id: String(stored._id),
        title: 'Blue backpack',
        privateInfo: PRIVATE_TEXT,
      });
    });

    it('never returns the owner or the internal fields', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { title: 'Blue backpack' });

      for (const hidden of ['owner', 'statusBeforeHidden', 'deletedAt', '_id', '__v']) {
        expect(Object.keys(res.body.declaration)).not.toContain(hidden);
      }
    });

    it('is the same view as the detail route, afterwards', async () => {
      const stored = await declare(sara);

      const patched = await patch(stored._id, { title: 'Blue backpack', location: 'Cafeteria' });
      const read = await request(ctx.app)
        .get(`${URL}/${stored._id}`)
        .set('Authorization', `Bearer ${saraToken}`);

      expect(patched.body.declaration).toEqual(read.body.declaration);
    });

    it('shows the new values to a stranger, without the private info', async () => {
      const stored = await declare(sara);

      await patch(stored._id, { title: 'Blue backpack' });
      const read = await request(ctx.app)
        .get(`${URL}/${stored._id}`)
        .set('Authorization', `Bearer ${omarToken}`);

      expect(read.body.declaration.title).toBe('Blue backpack');
      expect(JSON.stringify(read.body)).not.toContain('name on page 1');
    });
  });

  describe('an admin', () => {
    it.each(['pending', 'matched', 'hidden', 'resolved', 'expired'])(
      'edits a %s declaration that is not theirs, and the status stays',
      async (status) => {
        const stored = await declare(sara, {
          status,
          statusBeforeHidden: status === 'hidden' ? 'pending' : null,
        });

        const res = await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.declaration.title).toBe('Blue backpack');
        expect(res.body.declaration.status).toBe(status);
        const saved = await reload(stored._id);
        expect(saved.status).toBe(status);
        expect(String(saved.owner)).toBe(String(sara._id));
      },
    );

    it('gets the private info in the response', async () => {
      const stored = await declare(sara);

      const res = await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${adminToken}`);

      expect(res.body.declaration.privateInfo).toBe(PRIVATE_TEXT);
    });

    it('cannot change the type, the owner or the status either', async () => {
      const stored = await declare(sara);

      const res = await patch(
        stored._id,
        { title: 'Blue backpack', status: 'resolved' },
        `Bearer ${adminToken}`,
      );

      expect(res.status).toBe(400);
    });

    it('announces the owner of the declaration, not the admin', async () => {
      const stored = await declare(sara);

      await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${adminToken}`);

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          changedFields: ['title'],
        },
      ]);
    });

    it('edits a declaration whose owner deleted their account', async () => {
      const stored = await declare(sara, { status: 'matched', privateInfo: null });
      await User.updateOne({ _id: sara._id }, { $set: { deletedAt: new Date() } });

      const res = await patch(stored._id, { title: 'Blue backpack' }, `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('the event', () => {
    it('announces declaration.updated with string ids and the fields that changed', async () => {
      const stored = await declare(sara);

      await patch(stored._id, { title: 'Blue backpack', location: 'Cafeteria' });

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          changedFields: ['title', 'location'],
        },
      ]);
      expect(typeof events[0].declarationId).toBe('string');
      expect(typeof events[0].ownerId).toBe('string');
    });

    it('does not announce a field that was sent with its stored value', async () => {
      const stored = await declare(sara);

      await patch(stored._id, { title: 'Black backpack', location: 'Cafeteria' });

      expect(events[0].changedFields).toEqual(['location']);
    });

    it('is listened to after the save, so a listener finds the new values', async () => {
      const stored = await declare(sara);
      let seen;
      const stop = ctx.eventBus.on('declaration.updated', async ({ declarationId }) => {
        seen = (await Declaration.findById(declarationId).lean()).title;
      });

      await patch(stored._id, { title: 'Blue backpack' });
      stop();

      expect(seen).toBe('Blue backpack');
    });

    it('does not turn a failing listener into an error response', async () => {
      const stored = await declare(sara);
      const stop = ctx.eventBus.on('declaration.updated', () => {
        throw new Error('listener broke');
      });

      const res = await patch(stored._id, { title: 'Blue backpack' });
      stop();

      expect(res.status).toBe(200);
      expect((await reload(stored._id)).title).toBe('Blue backpack');
    });
  });

  describe('when nothing changes', () => {
    it('answers 200 with the full view, writes nothing and announces nothing', async () => {
      const stored = await declare(sara);
      const before = await reload(stored._id);

      const res = await patch(stored._id, {
        title: 'Black backpack',
        date: '2026-10-12',
        attributes: { color: 'black', brand: 'Nike' },
      });

      expect(res.status).toBe(200);
      expect(res.body.declaration.privateInfo).toBe(PRIVATE_TEXT);
      expect(await reload(stored._id)).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('when the status moves while it is edited', () => {
    const repository = () => ctx.declarationRepository;

    it('writes nothing if the status is no longer the one the decision was based on', async () => {
      const stored = await declare(sara, { status: 'matched' });

      const result = await repository().updateFields(
        stored._id,
        { title: 'Blue backpack' },
        'pending',
      );

      expect(result).toBeNull();
      expect((await reload(stored._id)).title).toBe('Black backpack');
    });

    it('writes and returns the document, private info included, when the status still matches', async () => {
      const stored = await declare(sara);

      const result = await repository().updateFields(
        stored._id,
        { title: 'Blue backpack' },
        'pending',
      );

      expect(result.title).toBe('Blue backpack');
      expect(result.privateInfo).toBe(PRIVATE_TEXT);
    });

    it('checks the model rules again on the update', async () => {
      const stored = await declare(sara);

      await expect(
        repository().updateFields(stored._id, { category: 'spaceship' }, 'pending'),
      ).rejects.toThrow(/category/);
      expect((await reload(stored._id)).category).toBe('wallet_bag');
    });
  });

  describe('routing', () => {
    it('does not read /mine as an id', async () => {
      const res = await patch('mine', { title: 'Blue backpack' });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('id');
    });

    it('does not touch the declarations of other users', async () => {
      const mine = await declare(sara);
      const theirs = await declare(omar);

      await patch(mine._id, { title: 'Blue backpack' });

      expect((await reload(theirs._id)).title).toBe('Black backpack');
    });
  });
});
