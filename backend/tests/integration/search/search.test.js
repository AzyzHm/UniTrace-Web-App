/**
 * FICHIER : tests/integration/search/search.test.js
 *
 * RÔLE
 *   Teste la recherche avec une VRAIE base MongoDB en mémoire.
 *   Texte et pertinence, index texte utilisé, filtres combinés, photo, pagination sans doublon, statuts cachés, cache des filtres. Nécessite le binaire mongod (télécharge au premier lancement ; lancé par la CI GitHub).
 *
 * TESTE
 *   toute la chaîne de recherche, de la route à MongoDB
 *
 * UTILISE
 *   vitest (describe/it/expect), supertest (requêtes HTTP), tests/helpers/* (app de test, base en mémoire).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/integration/search/search.test.js
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';
// added this import
import { EVENTS } from '../../../src/constants/common/events.js';


const SEARCH = '/api/v1/search/declarations';
const FILTERS = '/api/v1/search/filters';

describe('search endpoints (with a database)', () => {
  let ctx;
  let sara;
  let token;
  let adminToken;

  const get = (url, bearer = token) =>
    request(ctx.app).get(url).set('Authorization', `Bearer ${bearer}`);

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

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    // The text index must exist before the first $text query.
    await Declaration.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
      await ctx.eventBus.emit(EVENTS.DECLARATION_CREATED, {}); // empties the filters cache
    sara = await User.create({
      username: 'sara.k',
      email: 'sara.k@isamm.uma.tn',
      password: await ctx.passwordHasher.hash('Secret123'),
      isEmailVerified: true,
    });
    const admin = await User.create({
      username: 'admin',
      email: 'admin@isamm.uma.tn',
      password: await ctx.passwordHasher.hash('Secret123'),
      isEmailVerified: true,
      role: 'admin',
    });
    token = ctx.tokenService.signAccessToken(sara);
    adminToken = ctx.tokenService.signAccessToken(admin);
  });

  it('leaves out hidden, deleted and soft deleted declarations by default', async () => {
    await declare({ title: 'Active one' });
    await declare({ title: 'Hidden one', status: 'hidden' });
    await declare({ title: 'Deleted one', status: 'deleted', deletedAt: new Date() });

    const res = await get(SEARCH);

    expect(res.body.data.map((d) => d.title)).toEqual(['Active one']);
  });

  it('never returns privateInfo or the owner', async () => {
    await declare();

    const res = await get(SEARCH);

    expect(JSON.stringify(res.body)).not.toMatch(/Physics notebook|privateInfo|owner/);
  });

  it('lets an admin find hidden declarations and refuses a user', async () => {
    await declare({ status: 'hidden' });

    const forAdmin = await get(`${SEARCH}?status=hidden`, adminToken);
    const forUser = await get(`${SEARCH}?status=hidden`);

    expect(forAdmin.body.data).toHaveLength(1);
    expect(forUser.status).toBe(400);
    expect(forUser.body.error.code).toBe('STATUS_FORBIDDEN');
  });

  it('combines the structured filters with AND', async () => {
    await declare({ title: 'Wanted', type: 'found', picture: 'a.jpg', location: 'Library' });
    await declare({ title: 'Wrong type', type: 'lost', picture: 'b.jpg', location: 'Library' });
    await declare({ title: 'Wrong color', type: 'found', attributes: { color: 'red' } });

    const res = await get(
      `${SEARCH}?type=found&category=wallet_bag&color=black&hasPhoto=true&dateFrom=2026-10-01&dateTo=2026-10-12`,
    );

    expect(res.body.data.map((d) => d.title)).toEqual(['Wanted']);
  });

  it('includes the whole last day of a date only dateTo', async () => {
    await declare({ date: new Date('2026-10-12T15:30:00Z') });

    expect((await get(`${SEARCH}?dateTo=2026-10-12`)).body.data).toHaveLength(1);
    expect((await get(`${SEARCH}?dateTo=2026-10-11`)).body.data).toHaveLength(0);
  });

  it('does not count a student card picture as a photo', async () => {
    await declare({ category: 'student_card_id', picture: 'card.jpg' });

    expect((await get(`${SEARCH}?hasPhoto=true`)).body.data).toHaveLength(0);
    expect((await get(`${SEARCH}?hasPhoto=false`)).body.data).toHaveLength(1);
  });

  it('finds a text query and sorts by relevance, title first', async () => {
    await declare({ title: 'Blue umbrella', description: 'Found near the sac noir stand.' });
    await declare({ title: 'Sac noir', description: 'A bag in the hall.' });
    await declare({ title: 'Keys', description: 'Nothing to see.' });

    const res = await get(`${SEARCH}?q=sac%20noir&sort=relevance`);

    expect(res.body.data.map((d) => d.title)).toEqual(['Sac noir', 'Blue umbrella']);
    expect(res.body.appliedFilters.q).toBe('sac noir');
  });

  it('uses the text index', async () => {
    await declare();

    const plan = await Declaration.find({ $text: { $search: 'backpack' } })
      .explain('queryPlanner')
      .then((p) => JSON.stringify(p));

    expect(plan).toContain('TEXT');
  });

  it('falls back to a loose location match', async () => {
    await declare({ location: 'Bibliothèque, 2e étage' });

    const res = await get(`${SEARCH}?location=bibliotheque`);

    expect(res.body.data).toHaveLength(1);
  });

  it('pages without duplicates or gaps, even when dates are equal', async () => {
    await Declaration.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        title: `Item ${i}`,
        type: 'lost',
        description: 'Same date for every item.',
        date: new Date('2026-10-12T00:00:00Z'),
        location: 'Library',
        category: 'other',
        owner: sara._id,
      })),
    );

    const ids = [];
    for (const page of [1, 2, 3]) {
      const res = await get(`${SEARCH}?limit=10&page=${page}`);
      ids.push(...res.body.data.map((d) => d.id));
      if (page === 1) expect(res.body.pagination).toMatchObject({ hasNext: true, hasPrev: false });
      if (page === 3) expect(res.body.pagination).toMatchObject({ hasNext: false, hasPrev: true });
    }

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('answers an empty page after the last one', async () => {
    await declare();

    const res = await get(`${SEARCH}?page=9`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.noResults).toBe(false);
  });

  it('answers noResults when nothing matches', async () => {
    const res = await get(`${SEARCH}?category=keys`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [], noResults: true, pagination: { total: 0 } });
  });

  describe('GET /search/filters', () => {
    it('lists the locations and colors of the active declarations, most used first then sorted', async () => {
      await declare({ location: 'Library', attributes: { color: 'black' } });
      await declare({ location: 'Library', attributes: { color: 'white' } });
      await declare({ location: 'Amphi B', attributes: { color: 'black' } });
      await declare({ location: 'Hidden place', status: 'hidden', attributes: { color: 'pink' } });

      const res = await get(FILTERS);

      expect(res.body.locations.map((l) => l.key)).toEqual(['Amphi B', 'Library']);
      expect(res.body.colors).toEqual(['black', 'white']);
    });

    it('serves the second call from the cache, until a declaration changes', async () => {
      await declare({ location: 'Library' });
      await get(FILTERS);

      // Written behind the service's back: the cache does not know about it yet.
      await declare({ location: 'Gym' });
      expect((await get(FILTERS)).body.locations.map((l) => l.key)).toEqual(['Library']);

      await ctx.eventBus.emit('declaration.created', {});
      expect((await get(FILTERS)).body.locations.map((l) => l.key)).toEqual(['Gym', 'Library']);
    });
  });
});
