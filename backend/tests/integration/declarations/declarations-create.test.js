import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/declarations';
const PASSWORD = 'Secret123';

const BODY = {
  title: 'Black backpack',
  type: 'lost',
  description: 'Black Nike backpack with a red keychain, lost Monday afternoon.',
  date: '2026-10-12',
  location: 'Main library, 2nd floor',
  category: 'wallet_bag',
  attributes: { brand: 'Nike', color: 'black' },
  privateInfo: 'Physics notebook inside with my name on page 1',
};

describe('POST /api/v1/declarations', () => {
  let ctx;
  let user;
  let token;

  const post = (body, header = `Bearer ${token}`) => {
    const req = request(ctx.app).post(URL).send(body);
    return header ? req.set('Authorization', header) : req;
  };
  const withoutField = (field) =>
    Object.fromEntries(Object.entries(BODY).filter(([key]) => key !== field));

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    user = await User.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
    });
    token = ctx.tokenService.signAccessToken(user);
  });

  describe('creating', () => {
    it('answers 201 with the owner view of the new declaration', async () => {
      const res = await post(BODY);

      expect(res.status).toBe(201);
      expect(Object.keys(res.body)).toEqual(['declaration']);
      expect(res.body.declaration).toMatchObject({
        title: BODY.title,
        type: 'lost',
        description: BODY.description,
        category: 'wallet_bag',
        attributes: { brand: 'Nike', color: 'black' },
        privateInfo: BODY.privateInfo,
        picture: null,
        status: 'pending',
        location: BODY.location,
      });
      expect(res.body.declaration.id).toMatch(/^[a-f0-9]{24}$/);
      expect(new Date(res.body.declaration.date).toISOString()).toBe('2026-10-12T00:00:00.000Z');
      expect(res.body.declaration.createdAt).toBeTruthy();
    });

    it('never leaks the owner, the internal fields or Mongoose internals', async () => {
      const res = await post(BODY);
      const keys = Object.keys(res.body.declaration);

      expect(keys).not.toContain('owner');
      expect(keys).not.toContain('statusBeforeHidden');
      expect(keys).not.toContain('deletedAt');
      expect(keys).not.toContain('_id');
      expect(keys).not.toContain('__v');
    });

    it('stores it for the user of the token, as pending, with the private detail', async () => {
      const res = await post(BODY);

      const stored = await Declaration.findById(res.body.declaration.id).select('+privateInfo');
      expect(String(stored.owner)).toBe(String(user._id));
      expect(stored.status).toBe('pending');
      expect(stored.statusBeforeHidden).toBeNull();
      expect(stored.deletedAt).toBeNull();
      expect(stored.privateInfo).toBe(BODY.privateInfo);
      expect(Object.fromEntries(stored.attributes)).toEqual({ brand: 'Nike', color: 'black' });
      expect(await Declaration.countDocuments()).toBe(1);
    });

    it('works with only the six required fields', async () => {
      const res = await post({
        title: BODY.title,
        type: 'found',
        description: BODY.description,
        date: BODY.date,
        location: BODY.location,
        category: 'keys',
      });

      expect(res.status).toBe(201);
      expect(res.body.declaration.type).toBe('found');
      expect(res.body.declaration.attributes).toEqual({});
      expect(res.body.declaration.privateInfo).toBeNull();
    });

    it('trims the text fields', async () => {
      const res = await post({ ...BODY, title: '  Black backpack ', location: ' Library ' });

      expect(res.body.declaration.title).toBe('Black backpack');
      expect(res.body.declaration.location).toBe('Library');
    });

    it('accepts the day the item was lost, as of now', async () => {
      const res = await post({ ...BODY, date: new Date().toISOString() });

      expect(res.status).toBe(201);
    });

    it('lets one user declare several items', async () => {
      await post(BODY);
      const second = await post({ ...BODY, title: 'AirPods Pro', category: 'earbuds_headphones' });

      expect(second.status).toBe(201);
      expect(await Declaration.countDocuments({ owner: user._id })).toBe(2);
    });
  });

  describe('the event', () => {
    it('announces declaration.created with string ids once it is saved', async () => {
      const received = [];
      const off = ctx.eventBus.on('declaration.created', async (payload) => {
        // The matching code reads the database from its listener, so the
        // declaration must already be there.
        received.push({ payload, saved: await Declaration.exists({ _id: payload.declarationId }) });
      });

      const res = await post(BODY);
      off();

      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({
        declarationId: res.body.declaration.id,
        ownerId: String(user._id),
        type: 'lost',
        category: 'wallet_bag',
      });
      expect(received[0].saved).toBeTruthy();
    });

    it('still answers 201 when a listener fails', async () => {
      const off = ctx.eventBus.on('declaration.created', () => {
        throw new Error('listener broke');
      });

      const res = await post(BODY);
      off();

      expect(res.status).toBe(201);
      expect(await Declaration.countDocuments()).toBe(1);
    });

    it('announces nothing for a refused request', async () => {
      const received = [];
      const off = ctx.eventBus.on('declaration.created', (payload) => received.push(payload));

      await post({ ...BODY, title: 'ab' });
      off();

      expect(received).toEqual([]);
    });
  });

  describe('fields the server decides', () => {
    it.each([
      ['status', 'resolved'],
      ['owner', '507f1f77bcf86cd799439011'],
      ['deletedAt', '2026-01-01'],
      ['statusBeforeHidden', 'matched'],
      ['picture', 'uploads/evil.png'],
      ['_id', '507f1f77bcf86cd799439011'],
    ])('refuses "%s" and saves nothing', async (field, value) => {
      const res = await post({ ...BODY, [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([{ field, message: `${field} is not allowed` }]);
      expect(await Declaration.countDocuments()).toBe(0);
    });
  });

  describe('validation', () => {
    it('lists every missing required field at once', async () => {
      const res = await post({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d) => d.field).sort()).toEqual(
        ['category', 'date', 'description', 'location', 'title', 'type'].sort(),
      );
    });

    it.each(['title', 'type', 'description', 'date', 'location', 'category'])(
      'refuses a body without "%s"',
      async (field) => {
        const res = await post(withoutField(field));

        expect(res.status).toBe(400);
        expect(res.body.error.details.map((d) => d.field)).toEqual([field]);
      },
    );

    it('refuses a date in the future, and saves nothing', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const res = await post({ ...BODY, date: tomorrow });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'date', message: 'Date cannot be in the future' },
      ]);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it.each([
      ['an unknown category', { category: 'spaceship' }, 'category'],
      ['an unknown type', { type: 'stolen' }, 'type'],
      ['a short title', { title: 'ab' }, 'title'],
      ['a short description', { description: 'too short' }, 'description'],
      ['a timestamp as the date', { date: 1760000000000 }, 'date'],
      ['a bad attribute value', { attributes: { brand: 5 } }, 'attributes.brand'],
      ['a bad attribute key', { attributes: { $where: 'x' } }, 'attributes.$where'],
    ])('refuses %s', async (_label, override, field) => {
      const res = await post({ ...BODY, ...override });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field)).toEqual([field]);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('refuses NoSQL operator objects instead of passing them to the database', async () => {
      const res = await post({ ...BODY, title: { $ne: '' }, category: { $in: ['phone'] } });

      expect(res.status).toBe(400);
      // A set, because one bad value can break two rules of the same field.
      const fields = new Set(res.body.error.details.map((d) => d.field));
      expect([...fields].sort()).toEqual(['category', 'title']);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('refuses an impossible calendar day instead of saving another day', async () => {
      const res = await post({ ...BODY, date: '2026-02-31' });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'date', message: 'Date must be a valid ISO date, for example 2026-10-12' },
      ]);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('refuses a malformed JSON body with the shared error format', async () => {
      const res = await request(ctx.app)
        .post(URL)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send('{"title": ');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('authentication', () => {
    it('answers 401 without a token, and saves nothing', async () => {
      const res = await post(BODY, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('answers 401 for a garbage token', async () => {
      const res = await post(BODY, 'Bearer not.a.token');

      expect(res.status).toBe(401);
    });

    it('checks the token before the body, so an anonymous caller learns nothing about the rules', async () => {
      const res = await post({}, null);

      expect(res.status).toBe(401);
    });

    it('cuts off a suspended user at once', async () => {
      await User.updateOne({ _id: user._id }, { isActive: false });

      const res = await post(BODY);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('answers 401 once the account is deleted', async () => {
      await User.updateOne({ _id: user._id }, { deletedAt: new Date() });

      const res = await post(BODY);

      expect(res.status).toBe(401);
      expect(await Declaration.countDocuments()).toBe(0);
    });
  });
});
