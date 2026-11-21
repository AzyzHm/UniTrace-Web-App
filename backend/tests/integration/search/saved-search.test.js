/**
 * FICHIER : tests/integration/search/saved-search.test.js
 *
 * RÔLE
 *   Teste les recherches sauvegardées de bout en bout avec une VRAIE base MongoDB en mémoire :
 *   POST /search/saved, GET /search/saved, DELETE /search/saved/:id.
 *   Ce que seule une vraie base peut prouver : la recherche est bien enregistrée avec le bon
 *   propriétaire, chaque utilisateur ne voit et ne supprime que les siennes (404 sinon), la
 *   limite de 20 est appliquée, et supprimer un compte efface ses alertes.
 *   Nécessite le binaire mongod (télécharge au premier lancement ; lancé par la CI GitHub).
 *
 * TESTE
 *   routes + validators + service + repository + modèle des recherches sauvegardées
 *
 * UTILISE
 *   vitest, supertest, tests/helpers/* (app de test, base en mémoire).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/integration/search/saved-search.test.js
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { SavedSearch } from '../../../src/models/search/saved-search.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const SAVED = '/api/v1/search/saved';

describe('saved searches (with a database)', () => {
  let ctx;
  let sara;
  let karim;
  let saraToken;
  let karimToken;

  const asSara = (method, url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${saraToken}`);
  const asKarim = (method, url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${karimToken}`);

  const createUser = async (username) =>
    User.create({
      username,
      email: `${username}@isamm.uma.tn`,
      password: await ctx.passwordHasher.hash('Secret123'),
      isEmailVerified: true,
    });

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await SavedSearch.init();
    ctx = buildTestApp();
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    sara = await createUser('sara.k');
    karim = await createUser('karim.b');
    saraToken = ctx.tokenService.signAccessToken(sara);
    karimToken = ctx.tokenService.signAccessToken(karim);
  });

  describe('POST /search/saved', () => {
    it('answers 401 without a token', async () => {
      const res = await request(ctx.app).post(SAVED).send({ type: 'lost' });

      expect(res.status).toBe(401);
    });

    it('stores the criteria for the connected user', async () => {
      const res = await asSara('post', SAVED).send({
        name: 'My bag',
        q: 'sac noir',
        type: 'lost',
        category: 'wallet_bag',
        location: 'Library',
        color: 'black',
        hasPhoto: false,
      });

      expect(res.status).toBe(201);
      expect(res.body.savedSearch).toMatchObject({
        name: 'My bag',
        criteria: {
          q: 'sac noir',
          type: 'lost',
          category: 'wallet_bag',
          location: 'Library',
          color: 'black',
          hasPhoto: false,
        },
      });
      const stored = await SavedSearch.findById(res.body.savedSearch.id);
      expect(String(stored.owner)).toBe(String(sara._id));
      expect(stored.criteria.hasPhoto).toBe(false);
    });

    it('never returns the owner', async () => {
      const res = await asSara('post', SAVED).send({ type: 'lost' });

      expect(JSON.stringify(res.body)).not.toMatch(/owner|__v/);
      expect(JSON.stringify(res.body)).not.toContain(String(sara._id));
    });

    it('stores a date only dateTo as the end of that day', async () => {
      const res = await asSara('post', SAVED).send({
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      });

      expect(res.status).toBe(201);
      expect(res.body.savedSearch.criteria.dateTo).toBe('2026-10-31T23:59:59.999Z');
    });

    it('ignores an owner sent by the client', async () => {
      const res = await asSara('post', SAVED).send({ type: 'lost', owner: String(karim._id) });

      expect(res.status).toBe(400);
      expect(await SavedSearch.countDocuments()).toBe(0);
    });

    it('refuses an empty search and stores nothing', async () => {
      const res = await asSara('post', SAVED).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await SavedSearch.countDocuments()).toBe(0);
    });

    it('answers 409 SAVED_SEARCH_LIMIT at 20 searches, and does not count other users', async () => {
      await SavedSearch.insertMany(
        Array.from({ length: 20 }, (_, i) => ({
          owner: sara._id,
          name: `s${i}`,
          criteria: { type: 'lost' },
        })),
      );

      const refused = await asSara('post', SAVED).send({ type: 'found' });
      const otherUser = await asKarim('post', SAVED).send({ type: 'found' });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('SAVED_SEARCH_LIMIT');
      expect(otherUser.status).toBe(201);
      expect(await SavedSearch.countDocuments({ owner: sara._id })).toBe(20);
    });
  });

  describe('GET /search/saved', () => {
    it('answers an empty list', async () => {
      const res = await asSara('get', SAVED);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });

    it('lists only my searches, newest first', async () => {
      await SavedSearch.create({
        owner: sara._id,
        name: 'older',
        criteria: { type: 'lost' },
        createdAt: new Date('2026-11-01T10:00:00Z'),
      });
      await SavedSearch.create({
        owner: sara._id,
        name: 'newer',
        criteria: { type: 'found' },
        createdAt: new Date('2026-11-02T10:00:00Z'),
      });
      await SavedSearch.create({
        owner: karim._id,
        name: 'not mine',
        criteria: { type: 'found' },
      });

      const res = await asSara('get', SAVED);

      expect(res.status).toBe(200);
      expect(res.body.data.map((s) => s.name)).toEqual(['newer', 'older']);
      expect(JSON.stringify(res.body)).not.toContain('not mine');
      expect(JSON.stringify(res.body)).not.toMatch(/owner|__v/);
    });

    it('shows a search I just saved', async () => {
      const created = await asSara('post', SAVED).send({ q: 'clés', hasPhoto: true });

      const res = await asSara('get', SAVED);

      expect(res.body.data).toEqual([created.body.savedSearch]);
    });
  });

  describe('DELETE /search/saved/:id', () => {
    it('deletes my own search with 204', async () => {
      const created = await asSara('post', SAVED).send({ type: 'lost' });

      const res = await asSara('delete', `${SAVED}/${created.body.savedSearch.id}`);

      expect(res.status).toBe(204);
      expect(await SavedSearch.countDocuments()).toBe(0);
    });

    it("answers 404 and keeps the search when it is someone else's", async () => {
      const mine = await SavedSearch.create({ owner: sara._id, criteria: { type: 'lost' } });

      const res = await asKarim('delete', `${SAVED}/${mine._id}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await SavedSearch.countDocuments()).toBe(1);
    });

    it('answers 404 for an id that does not exist', async () => {
      const res = await asSara('delete', `${SAVED}/650000000000000000000999`);

      expect(res.status).toBe(404);
    });

    it('answers 400 for an id that is not valid', async () => {
      const res = await asSara('delete', `${SAVED}/not-an-id`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('answers 404 the second time', async () => {
      const created = await asSara('post', SAVED).send({ type: 'lost' });
      await asSara('delete', `${SAVED}/${created.body.savedSearch.id}`);

      const res = await asSara('delete', `${SAVED}/${created.body.savedSearch.id}`);

      expect(res.status).toBe(404);
    });
  });

  describe('account deletion', () => {
    it('removes the saved searches of the deleted user only', async () => {
      await SavedSearch.create({ owner: sara._id, criteria: { type: 'lost' } });
      await SavedSearch.create({ owner: sara._id, criteria: { type: 'found' } });
      await SavedSearch.create({ owner: karim._id, criteria: { type: 'lost' } });

      await ctx.eventBus.emit(EVENTS.USER_DELETED, {
        userId: String(sara._id),
        deletedAt: new Date(),
      });

      expect(await SavedSearch.countDocuments({ owner: sara._id })).toBe(0);
      expect(await SavedSearch.countDocuments({ owner: karim._id })).toBe(1);
    });
  });
});
