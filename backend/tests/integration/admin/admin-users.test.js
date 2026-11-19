import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../../src/models/admin/audit-log.model.js';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/admin/users';
const PASSWORD = 'Secret123';

describe('admin user management (real database)', () => {
  let ctx;
  let admin;
  let adminToken;
  let sara;
  let saraToken;
  let omar;
  let omarToken;

  const as = (token) => `Bearer ${token}`;

  const createUser = async (username, extra = {}) =>
    User.create({
      username,
      email: `${username}@isamm.uma.tn`,
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
      ...extra,
    });

  const list = (query = '', token = adminToken) =>
    request(ctx.app).get(`${URL}${query}`).set('Authorization', as(token));

  const remove = (id, token = adminToken, body = { reason: 'Spam account' }) =>
    request(ctx.app).delete(`${URL}/${id}`).set('Authorization', as(token)).send(body);

  const declare = (owner) =>
    Declaration.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library, 2nd floor',
      category: 'wallet_bag',
      attributes: { brand: 'Nike' },
      privateInfo: 'Physics notebook inside',
      owner: owner._id,
    });

  const reload = (id) => User.findById(id).lean();

  beforeAll(async () => {
    await connectTestDb();
    await Promise.all([User.init(), Declaration.init(), AuditLog.init()]);
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    admin = await createUser('admin', { role: 'admin' });
    sara = await createUser('sara.k');
    omar = await createUser('omar.b');
    adminToken = ctx.tokenService.signAccessToken(admin);
    saraToken = ctx.tokenService.signAccessToken(sara);
    omarToken = ctx.tokenService.signAccessToken(omar);
  });

  describe('access', () => {
    it('answers 401 to the list without a token', async () => {
      const res = await request(ctx.app).get(URL);

      expect(res.status).toBe(401);
    });

    it('answers 401 to the delete without a token, and deletes nothing', async () => {
      const res = await request(ctx.app).delete(`${URL}/${sara._id}`).send({ reason: 'Spam' });

      expect(res.status).toBe(401);
      expect((await reload(sara._id)).deletedAt).toBeNull();
    });

    it('answers 403 to a regular user on the list', async () => {
      const res = await list('', saraToken);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('answers 403 to a regular user on the delete, and deletes nothing', async () => {
      const res = await remove(sara._id, omarToken);

      expect(res.status).toBe(403);
      expect((await reload(sara._id)).deletedAt).toBeNull();
    });
  });

  describe('listing', () => {
    it('lists every account and never returns a password', async () => {
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(3);
      expect(res.body.pagination.total).toBe(3);
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('cuts pages and counts the total pages', async () => {
      const res = await list('?limit=2&page=2');

      expect(res.body.users).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('answers 400 for a limit above 50, a page below 1, and an unknown parameter', async () => {
      expect((await list('?limit=51')).status).toBe(400);
      expect((await list('?page=0')).status).toBe(400);
      expect((await list('?role=admin')).status).toBe(400);
    });
  });

  describe('deleting', () => {
    it('answers 204 with no body and anonymizes the account', async () => {
      const res = await remove(sara._id);

      expect(res.status).toBe(204);
      const after = await reload(sara._id);
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(after.username).toBe(`deleted_user_${sara._id}`);
      expect(after.email).toBe(`deleted_${sara._id}@deleted.invalid`);
    });

    it('cuts off the deleted user at once, even with a token that is still valid', async () => {
      await remove(sara._id);

      const res = await request(ctx.app)
        .get('/api/v1/users/me')
        .set('Authorization', as(saraToken));

      expect(res.status).toBe(401);
    });

    it('removes the declarations of the deleted user, as a self-deletion does', async () => {
      const stored = await declare(sara);

      await remove(sara._id);

      const after = await Declaration.findById(stored._id).select('+privateInfo').lean();
      expect(after.status).toBe('deleted');
      expect(after.privateInfo).toBeNull();
    });

    it('writes an audit line with the reason and the admin as actor', async () => {
      await remove(sara._id, adminToken, { reason: 'Repeated spam' });

      const line = await AuditLog.findOne({ targetId: sara._id, action: 'user.deleted' }).lean();
      expect(line).toMatchObject({
        targetType: 'user',
        reason: 'Repeated spam',
      });
      expect(String(line.actor)).toBe(String(admin._id));
    });

    it('answers 400 for a missing reason, and changes nothing', async () => {
      const res = await remove(sara._id, adminToken, {});

      expect(res.status).toBe(400);
      expect((await reload(sara._id)).deletedAt).toBeNull();
      expect(await AuditLog.countDocuments({ targetId: sara._id })).toBe(0);
    });

    it('answers 409 when the admin tries to delete their own account', async () => {
      const res = await remove(admin._id);

      expect(res.status).toBe(409);
      expect((await reload(admin._id)).deletedAt).toBeNull();
    });

    it('answers 409 when the admin tries to delete another admin', async () => {
      const otherAdmin = await createUser('admin2', { role: 'admin' });

      const res = await remove(otherAdmin._id);

      expect(res.status).toBe(409);
      expect((await reload(otherAdmin._id)).deletedAt).toBeNull();
    });

    it('answers 404 for an unknown user', async () => {
      const res = await remove(new mongoose.Types.ObjectId());

      expect(res.status).toBe(404);
    });

    it('answers 404 the second time, so deleting twice is safe', async () => {
      await remove(sara._id);

      const res = await remove(sara._id);

      expect(res.status).toBe(404);
    });

    it('answers 400 for a malformed id', async () => {
      const res = await remove('not-an-id');

      expect(res.status).toBe(400);
    });
  });
});
