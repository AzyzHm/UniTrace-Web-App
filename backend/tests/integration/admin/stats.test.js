import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { Report } from '../../../src/models/admin/report.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/admin/stats';
const PASSWORD = 'Secret123';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('admin statistics (real database)', () => {
  let ctx;
  let admin;
  let adminToken;
  let sara;
  let saraToken;

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
      owner: owner._id,
      ...overrides,
    });

  const get = (query = '', token = adminToken) =>
    request(ctx.app).get(`${URL}${query}`).set('Authorization', `Bearer ${token}`);

  // Three active accounts (admin, sara, omar), one deleted account that must not count.
  // Declarations: two lost pending and one found matched on the 5th and 7th of November,
  // plus one deleted on the 5th that must not count either.
  // Reports: one open and one treated on the same declaration.
  const seed = async () => {
    const omar = await createUser('omar.b');
    await createUser('gone', { deletedAt: new Date('2026-11-01T00:00:00Z') });

    const day5 = new Date('2026-11-05T00:00:00Z');
    const day7 = new Date('2026-11-07T00:00:00Z');
    const first = await declare(sara, { createdAt: day5 });
    await declare(sara, { createdAt: day5 });
    await declare(sara, { type: 'found', status: 'matched', createdAt: day7 });
    await declare(sara, { status: 'deleted', deletedAt: new Date(), createdAt: day5 });

    await Report.create({ declaration: first._id, reporter: omar._id, reason: 'duplicate' });
    await Report.create({
      declaration: first._id,
      reporter: admin._id,
      reason: 'other',
      status: 'treated',
    });

    return { omar };
  };

  beforeAll(async () => {
    await connectTestDb();
    await Promise.all([User.init(), Declaration.init(), Report.init()]);
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    admin = await createUser('admin', { role: 'admin' });
    sara = await createUser('sara.k');
    adminToken = ctx.tokenService.signAccessToken(admin);
    saraToken = ctx.tokenService.signAccessToken(sara);
  });

  it('answers 401 without a token', async () => {
    const res = await request(ctx.app).get(URL);

    expect(res.status).toBe(401);
  });

  it('answers 403 to a regular user', async () => {
    const res = await get('', saraToken);

    expect(res.status).toBe(403);
  });

  it('counts active users, declarations and reports, and leaves out deleted ones', async () => {
    await seed();

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.users.active).toBe(3);
    expect(res.body.declarations.total).toBe(3);
    expect(res.body.declarations.byType).toEqual({ lost: 2, found: 1 });
    expect(res.body.declarations.byStatus).toMatchObject({ pending: 2, matched: 1, deleted: 0 });
    expect(res.body.declarations.matches).toBe(1);
    expect(res.body.reports.total).toBe(2);
    expect(res.body.reports.byStatus).toEqual({ open: 1, treated: 1, dismissed: 0 });
  });

  it('gives a timeline of declarations created per day within the range', async () => {
    await seed();

    const res = await get('?from=2026-11-01T00:00:00Z&to=2026-11-10T00:00:00Z');

    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([
      { date: '2026-11-05', created: 2 },
      { date: '2026-11-07', created: 1 },
    ]);
  });

  it('uses a 30 day range when none is given', async () => {
    const res = await get();

    const span = new Date(res.body.range.to) - new Date(res.body.range.from);
    expect(span).toBe(30 * DAY_MS);
  });

  it('answers 400 when from is after to', async () => {
    const res = await get('?from=2026-11-10T00:00:00Z&to=2026-11-01T00:00:00Z');

    expect(res.status).toBe(400);
  });

  it('answers 400 for a range longer than 366 days', async () => {
    const res = await get('?from=2025-01-01T00:00:00Z&to=2026-11-19T00:00:00Z');

    expect(res.status).toBe(400);
  });

  it('answers 400 for a date that is not ISO', async () => {
    const res = await get('?from=not-a-date');

    expect(res.status).toBe(400);
  });
});
