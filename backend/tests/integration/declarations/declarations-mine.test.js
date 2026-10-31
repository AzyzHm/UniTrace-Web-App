import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/declarations/mine';
const PASSWORD = 'Secret123';

describe('GET /api/v1/declarations/mine', () => {
  let ctx;
  let sara;
  let omar;
  let token;

  const get = (query = '', header = `Bearer ${token}`) => {
    const req = request(ctx.app).get(`${URL}${query}`);
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
      attributes: { brand: 'Nike' },
      privateInfo: 'Physics notebook with my name on page 1',
      owner: owner._id,
      ...overrides,
    });

  const createUser = async (username) =>
    User.create({
      username,
      email: `${username}@isamm.uma.tn`,
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
    });

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    sara = await createUser('sara.k');
    omar = await createUser('omar.b');
    token = ctx.tokenService.signAccessToken(sara);
  });

  describe('access', () => {
    it('answers 401 without a token', async () => {
      const res = await get('', null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 with a token that is not valid', async () => {
      const res = await get('', 'Bearer not-a-token');

      expect(res.status).toBe(401);
    });

    it('answers 403 for a suspended user', async () => {
      await User.updateOne({ _id: sara._id }, { isActive: false });

      const res = await get();

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('is read as the list route, not as an id', async () => {
      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('declarations');
    });
  });

  describe('listing', () => {
    it('answers 200 with an empty list and its pagination when there is nothing', async () => {
      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        declarations: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('returns only the declarations of the connected user', async () => {
      await declare(sara, { title: 'Sara backpack' });
      await declare(omar, { title: 'Omar backpack' });

      const res = await get();

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Sara backpack']);
      expect(res.body.pagination.total).toBe(1);
    });

    it('returns the list row of each declaration', async () => {
      const stored = await declare(sara);

      const res = await get();

      expect(res.body.declarations).toHaveLength(1);
      expect(res.body.declarations[0]).toMatchObject({
        id: String(stored._id),
        title: 'Black backpack',
        type: 'lost',
        category: 'wallet_bag',
        picture: null,
        status: 'pending',
        location: 'Main library, 2nd floor',
      });
      expect(new Date(res.body.declarations[0].date).toISOString()).toBe(
        '2026-10-12T00:00:00.000Z',
      );
    });

    it('never returns the private info, the owner or the internal fields', async () => {
      await declare(sara);

      const res = await get();
      const row = res.body.declarations[0];

      for (const hidden of [
        'privateInfo',
        'owner',
        'statusBeforeHidden',
        'deletedAt',
        '_id',
        '__v',
        'description',
        'attributes',
      ]) {
        expect(Object.keys(row)).not.toContain(hidden);
      }
      expect(JSON.stringify(res.body)).not.toContain('name on page 1');
    });

    it('lists the newest first', async () => {
      await declare(sara, { title: 'Oldest one', createdAt: new Date('2026-10-01') });
      await declare(sara, { title: 'Newest one', createdAt: new Date('2026-10-03') });

      const res = await get();

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Newest one', 'Oldest one']);
    });

    it('does not list a deleted declaration', async () => {
      await declare(sara, { title: 'Kept one' });
      await declare(sara, { title: 'Gone one', status: 'deleted', deletedAt: new Date() });

      const res = await get();

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Kept one']);
      expect(res.body.pagination.total).toBe(1);
    });

    it('lists a hidden declaration with its status', async () => {
      await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      const res = await get();

      expect(res.body.declarations[0].status).toBe('hidden');
    });
  });

  describe('filters', () => {
    beforeEach(async () => {
      await declare(sara, { title: 'Lost pending', type: 'lost' });
      await declare(sara, { title: 'Found pending', type: 'found' });
      await declare(sara, { title: 'Found matched', type: 'found', status: 'matched' });
    });

    it('filters on the type', async () => {
      const res = await get('?type=found');

      expect(res.body.declarations.map((d) => d.title).sort()).toEqual([
        'Found matched',
        'Found pending',
      ]);
      expect(res.body.pagination.total).toBe(2);
    });

    it('filters on the status', async () => {
      const res = await get('?status=matched');

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Found matched']);
    });

    it('combines type and status', async () => {
      const res = await get('?type=found&status=pending');

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Found pending']);
    });

    it('answers 200 with an empty list when nothing matches', async () => {
      const res = await get('?type=lost&status=matched');

      expect(res.status).toBe(200);
      expect(res.body.declarations).toEqual([]);
      expect(res.body.pagination.totalPages).toBe(0);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      for (let day = 1; day <= 5; day += 1) {
        await declare(sara, {
          title: `Item number ${day}`,
          createdAt: new Date(`2026-10-0${day}`),
        });
      }
    });

    it('returns the asked page and the page count', async () => {
      const res = await get('?page=2&limit=2');

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Item number 3', 'Item number 2']);
      expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
    });

    it('returns the short last page', async () => {
      const res = await get('?page=3&limit=2');

      expect(res.body.declarations.map((d) => d.title)).toEqual(['Item number 1']);
    });

    it('returns an empty list past the last page, with the real total', async () => {
      const res = await get('?page=9&limit=2');

      expect(res.status).toBe(200);
      expect(res.body.declarations).toEqual([]);
      expect(res.body.pagination).toEqual({ page: 9, limit: 2, total: 5, totalPages: 3 });
    });

    it('uses 20 per page by default', async () => {
      const res = await get();

      expect(res.body.pagination.limit).toBe(20);
    });
  });

  describe('validation', () => {
    it.each([
      ['limit=51', 'limit'],
      ['limit=0', 'limit'],
      ['limit=abc', 'limit'],
      ['page=0', 'page'],
      ['page=-1', 'page'],
      ['page=1.5', 'page'],
      ['type=stolen', 'type'],
      ['status=archived', 'status'],
      ['status=deleted', 'status'],
      ['type=', 'type'],
    ])('answers 400 for ?%s', async (query, field) => {
      const res = await get(`?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect([...new Set(res.body.error.details.map((d) => d.field))]).toEqual([field]);
    });

    it('refuses a parameter that is not allowed, such as another owner', async () => {
      const res = await get(`?owner=${omar._id}`);

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'owner', message: 'owner is not allowed' }]);
    });

    it('refuses an operator injected through the query string', async () => {
      await declare(sara, { status: 'deleted', deletedAt: new Date() });

      const res = await get('?status[$ne]=deleted');

      expect(res.status).toBe(400);
    });
  });
});
