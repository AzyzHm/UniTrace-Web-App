import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../../src/models/admin/audit-log.model.js';
import { Report } from '../../../src/models/admin/report.model.js';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const REPORTS = '/api/v1/reports';
const ADMIN_REPORTS = '/api/v1/admin/reports';
const ADMIN_DECLARATIONS = '/api/v1/admin/declarations';
const DECLARATIONS = '/api/v1/declarations';
const PASSWORD = 'Secret123';

describe('reports and declaration moderation (real database)', () => {
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

  const declare = (owner, overrides = {}) =>
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
      ...overrides,
    });

  const reload = (id) => Declaration.findById(id).select('+privateInfo').lean();

  const flag = (token, body) =>
    request(ctx.app).post(REPORTS).set('Authorization', as(token)).send(body);

  const listOpen = (token = adminToken) =>
    request(ctx.app).get(ADMIN_REPORTS).set('Authorization', as(token));

  const treat = (id, body, token = adminToken) =>
    request(ctx.app).patch(`${ADMIN_REPORTS}/${id}`).set('Authorization', as(token)).send(body);

  const moderate = (id, action, body, token = adminToken) =>
    request(ctx.app)
      .post(`${ADMIN_DECLARATIONS}/${id}/${action}`)
      .set('Authorization', as(token))
      .send(body);

  const remove = (id, body, token = adminToken) =>
    request(ctx.app)
      .delete(`${ADMIN_DECLARATIONS}/${id}`)
      .set('Authorization', as(token))
      .send(body);

  const readAs = (id, token) =>
    request(ctx.app).get(`${DECLARATIONS}/${id}`).set('Authorization', as(token));

  beforeAll(async () => {
    await connectTestDb();
    await Promise.all([User.init(), Declaration.init(), Report.init(), AuditLog.init()]);
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

  describe('flagging a declaration (users)', () => {
    it('lets a user report someone else declaration', async () => {
      const stored = await declare(sara);

      const res = await flag(omarToken, { declarationId: String(stored._id), reason: 'duplicate' });

      expect(res.status).toBe(201);
      expect(res.body.report).toMatchObject({
        declaration: String(stored._id),
        reason: 'duplicate',
        status: 'open',
      });
      expect(await Report.countDocuments({ declaration: stored._id })).toBe(1);
    });

    it('refuses to report your own declaration with 403, and saves nothing', async () => {
      const stored = await declare(sara);

      const res = await flag(saraToken, { declarationId: String(stored._id), reason: 'other' });

      expect(res.status).toBe(403);
      expect(await Report.countDocuments()).toBe(0);
    });

    it('refuses a second open report from the same user with 409', async () => {
      const stored = await declare(sara);
      await flag(omarToken, { declarationId: String(stored._id), reason: 'duplicate' });

      const res = await flag(omarToken, { declarationId: String(stored._id), reason: 'other' });

      expect(res.status).toBe(409);
      expect(await Report.countDocuments()).toBe(1);
    });

    it('answers 404 for an unknown or deleted declaration', async () => {
      const deleted = await declare(sara, { status: 'deleted' });

      const unknown = await flag(omarToken, {
        declarationId: String(new mongoose.Types.ObjectId()),
        reason: 'other',
      });
      const gone = await flag(omarToken, { declarationId: String(deleted._id), reason: 'other' });

      expect(unknown.status).toBe(404);
      expect(gone.status).toBe(404);
    });

    it('answers 400 for a malformed declarationId or an unknown reason', async () => {
      const stored = await declare(sara);

      const badId = await flag(omarToken, { declarationId: 'abc', reason: 'other' });
      const badReason = await flag(omarToken, {
        declarationId: String(stored._id),
        reason: 'spam',
      });

      expect(badId.status).toBe(400);
      expect(badReason.status).toBe(400);
    });

    it('answers 401 without a token', async () => {
      const stored = await declare(sara);

      const res = await request(ctx.app)
        .post(REPORTS)
        .send({ declarationId: String(stored._id), reason: 'other' });

      expect(res.status).toBe(401);
    });
  });

  describe('reviewing reports (admin)', () => {
    it('answers 403 to a regular user on the report list', async () => {
      const res = await listOpen(omarToken);

      expect(res.status).toBe(403);
    });

    it('lists only open reports, with the total', async () => {
      const stored = await declare(sara);
      await Report.create({ declaration: stored._id, reporter: omar._id, reason: 'duplicate' });
      await Report.create({
        declaration: stored._id,
        reporter: admin._id,
        reason: 'other',
        status: 'treated',
      });

      const res = await listOpen();

      expect(res.status).toBe(200);
      expect(res.body.reports).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('treats an open report, writes an audit line and stores the resolution', async () => {
      const stored = await declare(sara);
      const report = await Report.create({
        declaration: stored._id,
        reporter: omar._id,
        reason: 'duplicate',
      });

      const res = await treat(report._id, { status: 'treated', resolution: 'Duplicate removed' });

      expect(res.status).toBe(200);
      expect(res.body.report).toMatchObject({
        status: 'treated',
        resolution: 'Duplicate removed',
      });
      const line = await AuditLog.findOne({
        targetId: report._id,
        action: 'report.treated',
      }).lean();
      expect(String(line.actor)).toBe(String(admin._id));
    });

    it('can dismiss a report', async () => {
      const stored = await declare(sara);
      const report = await Report.create({
        declaration: stored._id,
        reporter: omar._id,
        reason: 'other',
      });

      const res = await treat(report._id, { status: 'dismissed' });

      expect(res.status).toBe(200);
      expect(res.body.report.status).toBe('dismissed');
    });

    it('answers 409 when the report is already treated', async () => {
      const stored = await declare(sara);
      const report = await Report.create({
        declaration: stored._id,
        reporter: omar._id,
        reason: 'other',
      });
      await treat(report._id, { status: 'treated' });

      const res = await treat(report._id, { status: 'dismissed' });

      expect(res.status).toBe(409);
    });

    it('answers 400 for a status other than treated or dismissed', async () => {
      const stored = await declare(sara);
      const report = await Report.create({
        declaration: stored._id,
        reporter: omar._id,
        reason: 'other',
      });

      const res = await treat(report._id, { status: 'open' });

      expect(res.status).toBe(400);
    });

    it('answers 404 for an unknown report', async () => {
      const res = await treat(new mongoose.Types.ObjectId(), { status: 'treated' });

      expect(res.status).toBe(404);
    });
  });

  describe('moderating a declaration (admin)', () => {
    it('hides a declaration with a reason and writes an audit line', async () => {
      const stored = await declare(sara);

      const res = await moderate(stored._id, 'hide', { reason: 'Looks like a fake listing' });

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe('hidden');
      const after = await reload(stored._id);
      expect(after.statusBeforeHidden).toBe('pending');
      const line = await AuditLog.findOne({
        targetId: stored._id,
        action: 'declaration.hidden',
      }).lean();
      expect(line.reason).toBe('Looks like a fake listing');
    });

    it('hides the declaration from a stranger, who now gets 404', async () => {
      const stored = await declare(sara);
      await moderate(stored._id, 'hide', { reason: 'Looks like a fake listing' });

      const res = await readAs(stored._id, omarToken);

      expect(res.status).toBe(404);
    });

    it('restores a hidden declaration to the status it had before', async () => {
      const stored = await declare(sara);
      await moderate(stored._id, 'hide', { reason: 'Checking it' });

      const res = await moderate(stored._id, 'restore', { reason: 'Checked, it is fine' });

      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe('pending');
    });

    it('answers 409 when hiding a declaration that is already hidden', async () => {
      const stored = await declare(sara);
      await moderate(stored._id, 'hide', { reason: 'First time' });

      const res = await moderate(stored._id, 'hide', { reason: 'Again' });

      expect(res.status).toBe(409);
    });

    it('answers 409 when restoring a declaration that is not hidden', async () => {
      const stored = await declare(sara);

      const res = await moderate(stored._id, 'restore', { reason: 'Reviewed' });

      expect(res.status).toBe(409);
    });

    it('refuses a missing reason with 400 and changes nothing', async () => {
      const stored = await declare(sara);

      const res = await moderate(stored._id, 'hide', {});

      expect(res.status).toBe(400);
      expect((await reload(stored._id)).status).toBe('pending');
    });

    it('answers 403 to a regular user, and changes nothing', async () => {
      const stored = await declare(sara);

      const res = await moderate(stored._id, 'hide', { reason: 'Spam' }, saraToken);

      expect(res.status).toBe(403);
      expect((await reload(stored._id)).status).toBe('pending');
    });

    it('deletes a declaration with 204, clears its private info and writes an audit line', async () => {
      const stored = await declare(sara);

      const res = await remove(stored._id, { reason: 'Offensive content' });

      expect(res.status).toBe(204);
      const after = await reload(stored._id);
      expect(after.status).toBe('deleted');
      expect(after.privateInfo).toBeNull();
      expect(
        await AuditLog.countDocuments({ targetId: stored._id, action: 'declaration.deleted' }),
      ).toBe(1);
    });

    it('answers 400 for a malformed id and 404 for an unknown one', async () => {
      const malformed = await moderate('not-an-id', 'hide', { reason: 'Spam' });
      const unknown = await moderate(new mongoose.Types.ObjectId(), 'hide', { reason: 'Spam' });

      expect(malformed.status).toBe(400);
      expect(unknown.status).toBe(404);
    });
  });
});
