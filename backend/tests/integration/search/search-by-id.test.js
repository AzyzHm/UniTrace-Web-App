/**
 * FICHIER : tests/integration/search/search-by-id.test.js
 *
 * RÔLE
 *   Teste GET /search/:id avec une VRAIE base MongoDB en mémoire : une déclaration active est
 *   lisible par tout utilisateur connecté, sans privateInfo ni owner ; hidden, deleted et
 *   supprimée en douceur répondent 404 à un utilisateur et 200 à un admin ; un id mal formé
 *   répond 400 ; les routes /filters et /saved ne sont pas confondues avec un id.
 *   Nécessite le binaire mongod (télécharge au premier lancement ; lancé par la CI GitHub).
 *
 * TESTE
 *   route + validateObjectId + service + repository (findById) + presenter public
 *
 * UTILISE
 *   vitest, supertest, tests/helpers/* (app de test, base en mémoire).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/integration/search/search-by-id.test.js
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const url = (id) => `/api/v1/search/${id}`;

describe('GET /search/:id (with a database)', () => {
  let ctx;
  let sara;
  let karimToken;
  let saraToken;
  let adminToken;

  const as = (token, path) => request(ctx.app).get(path).set('Authorization', `Bearer ${token}`);

  const declare = (overrides = {}) =>
    Declaration.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library',
      category: 'wallet_bag',
      attributes: { color: 'black' },
      privateInfo: 'Physics notebook with my name on page 1',
      owner: sara._id,
      ...overrides,
    });

  const createUser = async (username, extra = {}) =>
    User.create({
      username,
      email: `${username}@isamm.uma.tn`,
      password: await ctx.passwordHasher.hash('Secret123'),
      isEmailVerified: true,
      ...extra,
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
    const karim = await createUser('karim.b');
    const admin = await createUser('admin', { role: 'admin' });
    saraToken = ctx.tokenService.signAccessToken(sara);
    karimToken = ctx.tokenService.signAccessToken(karim);
    adminToken = ctx.tokenService.signAccessToken(admin);
  });

  it('answers 401 without a token', async () => {
    const found = await declare();

    const res = await request(ctx.app).get(url(found._id));

    expect(res.status).toBe(401);
  });

  it('shows an active declaration to another user, in the public shape', async () => {
    const found = await declare({ picture: 'photo.jpg' });

    const res = await as(karimToken, url(found._id));

    expect(res.status).toBe(200);
    expect(res.body.declaration).toMatchObject({
      id: String(found._id),
      title: 'Black backpack',
      type: 'lost',
      category: 'wallet_bag',
      location: 'Main library',
      status: 'pending',
      attributes: { color: 'black' },
    });
    expect(res.body.declaration.picture).toContain(String(found._id));
  });

  it('never returns privateInfo or the owner, not even to the owner or an admin', async () => {
    const found = await declare();

    for (const token of [karimToken, saraToken, adminToken]) {
      const res = await as(token, url(found._id));

      expect(JSON.stringify(res.body)).not.toMatch(/Physics notebook|privateInfo|owner/);
    }
  });

  it('hides the picture of a sensitive category (student card)', async () => {
    const found = await declare({ category: 'student_card_id', picture: 'card.jpg' });

    const res = await as(karimToken, url(found._id));

    expect(res.body.declaration.picture).toBeNull();
  });

  it.each([
    ['resolved', { status: 'resolved' }],
    ['expired', { status: 'expired' }],
    ['matched', { status: 'matched' }],
  ])('shows a %s declaration', async (label, change) => {
    const found = await declare(change);

    const res = await as(karimToken, url(found._id));

    expect(res.status).toBe(200);
  });

  it.each([
    ['hidden', { status: 'hidden' }],
    ['deleted', { status: 'deleted', deletedAt: new Date() }],
    ['soft deleted', { deletedAt: new Date() }],
  ])('answers 404 to a user and 200 to an admin for a %s declaration', async (label, change) => {
    const found = await declare(change);

    const forUser = await as(karimToken, url(found._id));
    const forOwner = await as(saraToken, url(found._id));
    const forAdmin = await as(adminToken, url(found._id));

    expect(forUser.status).toBe(404);
    expect(forUser.body.error.code).toBe('NOT_FOUND');
    expect(forOwner.status).toBe(404);
    expect(forAdmin.status).toBe(200);
  });

  it('answers 404 for a valid id that does not exist', async () => {
    const res = await as(karimToken, url('650000000000000000000999'));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(['not-an-id', '123', '65000000000000000000000z'])(
    'answers 400 for the invalid id %s',
    async (id) => {
      const res = await as(karimToken, url(id));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('does not read /filters, /saved or /declarations as an id', async () => {
    const filters = await as(karimToken, '/api/v1/search/filters');
    const saved = await as(karimToken, '/api/v1/search/saved');
    const search = await as(karimToken, '/api/v1/search/declarations');

    expect(filters.status).toBe(200);
    expect(saved.status).toBe(200);
    expect(search.status).toBe(200);
  });
});
