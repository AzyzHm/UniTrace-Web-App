/**
 * FICHIER : tests/unit/search/search-routes.test.js
 *
 * RÔLE
 *   Teste les vraies routes HTTP de recherche avec un faux repository et un faux requireAuth.
 *   Codes 401, 400 (INVALID_QUERY, RELEVANCE_REQUIRES_Q, STATUS_FORBIDDEN), 429 avec Retry-After, absence de privateInfo/owner dans la réponse. Ne nécessite pas MongoDB.
 *
 * TESTE
 *   routes + controller + validator + service de recherche
 *
 * UTILISE
 *   vitest (describe/it/expect), supertest (requêtes HTTP).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/search-routes.test.js
 */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createRateLimiters } from '../../../src/middlewares/common/rate-limiters.js';
import { createSavedSearchService } from '../../../src/services/search/saved-search.service.js';
import { createSearchService } from '../../../src/services/search/search.service.js';
import { UnauthenticatedError } from '../../../src/exceptions/app-error.js';

// The real routes, validator and service, with a fake repository and a fake requireAuth: no
// database is needed, so this runs everywhere. The database part is in tests/integration/search.
const declaration = {
  _id: '650000000000000000000001',
  title: 'Black backpack',
  type: 'lost',
  description: 'Black Nike backpack.',
  category: 'wallet_bag',
  attributes: { color: 'black' },
  picture: null,
  status: 'pending',
  date: new Date('2026-10-12T00:00:00Z'),
  location: 'Library',
  createdAt: new Date('2026-10-13T00:00:00Z'),
  // These must never come out of the API.
  privateInfo: 'secret notebook',
  owner: '650000000000000000000009',
  statusBeforeHidden: null,
};

// A tiny in-memory stand-in for the saved searches repository. Like the real one, every read and
// delete is scoped to the owner.
function fakeSavedSearchRepository() {
  const rows = [];
  let counter = 0;
  return {
    rows,
    create: vi.fn(async ({ owner, name, criteria }) => {
      counter += 1;
      const row = {
        _id: `65000000000000000000010${counter}`.slice(0, 24),
        owner,
        name,
        criteria,
        createdAt: new Date('2026-11-01T10:00:00Z'),
      };
      rows.push(row);
      return row;
    }),
    listByOwner: vi.fn(async (owner) => rows.filter((r) => r.owner === owner).reverse()),
    countByOwner: vi.fn(async (owner) => rows.filter((r) => r.owner === owner).length),
    deleteByIdAndOwner: vi.fn(async (id, owner) => {
      const index = rows.findIndex((r) => r._id === id && r.owner === owner);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    }),
    deleteAllByOwner: vi.fn(),
  };
}

function buildApp({ limits, role = 'user', userId = 'u1', found = declaration, maxSaved } = {}) {
  const savedSearchRepository = fakeSavedSearchRepository();
  const searchRepository = {
    count: vi.fn().mockResolvedValue(1),
    findPage: vi.fn().mockResolvedValue([declaration]),
    findById: vi.fn().mockResolvedValue(found),
    topLocations: vi.fn().mockResolvedValue(['Library']),
    topColors: vi.fn().mockResolvedValue(['black']),
  };
  const requireAuth = (req, res, next) => {
    if (!req.get('Authorization')) throw new UnauthenticatedError();
    req.user = { id: userId, role };
    next();
  };
  const app = createApp({
    // The users routes are mounted whenever requireAuth is given, and need their services.
    profileService: {},
    passwordChangeService: {},
    accountDeletionService: {},
    searchService: createSearchService({ searchRepository }),
    savedSearchService: createSavedSearchService({ savedSearchRepository, maxPerUser: maxSaved }),
    requireAuth,
    rateLimiters: limits ? createRateLimiters({ limits }) : null,
  });
  return { app, searchRepository, savedSearchRepository };
}

const get = (app, url) => request(app).get(url).set('Authorization', 'Bearer x');

describe('GET /api/v1/search/declarations', () => {
  it('answers 401 without a token', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/api/v1/search/declarations');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers with the documented shape', async () => {
    const { app } = buildApp();

    const res = await get(app, '/api/v1/search/declarations');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [expect.objectContaining({ id: declaration._id, title: 'Black backpack' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
      sort: { field: 'date', order: 'desc' },
      appliedFilters: {
        q: null,
        type: null,
        category: null,
        location: null,
        color: null,
        status: ['pending', 'matched'],
        dateFrom: null,
        dateTo: null,
        hasPhoto: null,
      },
      noResults: false,
    });
  });

  it('never returns privateInfo or the owner', async () => {
    const { app } = buildApp({ role: 'admin' });

    const res = await get(app, '/api/v1/search/declarations');

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret notebook');
    expect(text).not.toContain('privateInfo');
    expect(text).not.toContain('owner');
    expect(text).not.toContain('650000000000000000000009');
  });

  it('answers INVALID_QUERY for an unknown parameter', async () => {
    const { app } = buildApp();

    const res = await get(app, '/api/v1/search/declarations?foo=bar');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_QUERY');
    expect(res.body.error.details[0].field).toBe('foo');
  });

  it.each(['limit=999', 'page=0', 'type=stolen', 'dateFrom=2026-10-20&dateTo=2026-10-10'])(
    'answers INVALID_QUERY for ?%s',
    async (query) => {
      const { app } = buildApp();

      const res = await get(app, `/api/v1/search/declarations?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_QUERY');
    },
  );

  it('answers RELEVANCE_REQUIRES_Q for relevance without q', async () => {
    const { app } = buildApp();

    const res = await get(app, '/api/v1/search/declarations?sort=relevance');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEVANCE_REQUIRES_Q');
  });

  it('answers STATUS_FORBIDDEN when a user asks for hidden', async () => {
    const { app } = buildApp();

    const res = await get(app, '/api/v1/search/declarations?status=hidden');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STATUS_FORBIDDEN');
  });

  it('lets an admin ask for hidden,deleted,pending', async () => {
    const { app, searchRepository } = buildApp({ role: 'admin' });

    const res = await get(app, '/api/v1/search/declarations?status=hidden,deleted,pending');

    expect(res.status).toBe(200);
    expect(searchRepository.count.mock.calls[0][0].status.$in).toEqual([
      'hidden',
      'deleted',
      'pending',
    ]);
  });

  it('answers 429 with Retry-After after 50 requests in a window', async () => {
    const { app } = buildApp({ limits: { search: { windowMs: 60_000, limit: 2 } } });

    expect((await get(app, '/api/v1/search/declarations')).status).toBe(200);
    expect((await get(app, '/api/v1/search/declarations')).status).toBe(200);
    const res = await get(app, '/api/v1/search/declarations');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps the filter lists out of the search quota', async () => {
    const { app } = buildApp({ limits: { search: { windowMs: 60_000, limit: 1 } } });

    await get(app, '/api/v1/search/declarations');

    expect((await get(app, '/api/v1/search/filters')).status).toBe(200);
  });
});

describe('GET /api/v1/search/filters', () => {
  it('answers 401 without a token', async () => {
    const { app } = buildApp();

    expect((await request(app).get('/api/v1/search/filters')).status).toBe(401);
  });

  it('answers the dropdown values and queries the database once', async () => {
    const { app, searchRepository } = buildApp();

    const first = await get(app, '/api/v1/search/filters');
    await get(app, '/api/v1/search/filters');

    expect(first.status).toBe(200);
    expect(Object.keys(first.body)).toEqual([
      'type',
      'categories',
      'locations',
      'colors',
      'statuses',
      'hasPhoto',
    ]);
    expect(first.body.locations).toEqual([{ key: 'Library', label: 'Library' }]);
    expect(searchRepository.topLocations).toHaveBeenCalledTimes(1);
  });

  it('hides hidden and deleted from a user and shows them to an admin', async () => {
    const keys = async (role) =>
      (await get(buildApp({ role }).app, '/api/v1/search/filters')).body.statuses.map((s) => s.key);

    expect(await keys('user')).toEqual(['pending', 'matched', 'resolved', 'expired']);
    expect(await keys('admin')).toHaveLength(6);
  });

  it('answers 429 after 120 requests in a window', async () => {
    const { app } = buildApp({ limits: { searchFilters: { windowMs: 60_000, limit: 1 } } });

    await get(app, '/api/v1/search/filters');

    expect((await get(app, '/api/v1/search/filters')).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /search/saved, GET /search/saved, DELETE /search/saved/:id
// ---------------------------------------------------------------------------------------------
const SAVED = '/api/v1/search/saved';
const post = (app, body) => request(app).post(SAVED).set('Authorization', 'Bearer x').send(body);
const del = (app, url) => request(app).delete(url).set('Authorization', 'Bearer x');

describe('POST /api/v1/search/saved', () => {
  it('answers 401 without a token', async () => {
    const { app } = buildApp();

    const res = await request(app).post(SAVED).send({ type: 'lost' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('saves the criteria and answers 201 without leaking the owner', async () => {
    const { app, savedSearchRepository } = buildApp();

    const res = await post(app, {
      name: 'My bag',
      q: '  sac noir ',
      type: 'lost',
      hasPhoto: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.savedSearch).toEqual({
      id: expect.any(String),
      name: 'My bag',
      // trimmed by Joi; hasPhoto:false is a real choice and is kept
      criteria: { q: 'sac noir', type: 'lost', hasPhoto: false },
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('owner');
    // the owner is the connected user, never something the client sent
    expect(savedSearchRepository.create.mock.calls[0][0].owner).toBe('u1');
  });

  it('puts the end of the day on a date only dateTo, like the search does', async () => {
    const { app, savedSearchRepository } = buildApp();

    await post(app, { dateFrom: '2026-10-01', dateTo: '2026-10-31' });

    const { criteria } = savedSearchRepository.create.mock.calls[0][0];
    expect(criteria.dateTo.toISOString()).toBe('2026-10-31T23:59:59.999Z');
  });

  it.each([
    ['an empty body', {}],
    ['only a name', { name: 'Nothing to watch' }],
    ['a one character text', { q: 'a' }],
    ['an unknown type', { type: 'stolen' }],
    ['a field that is not a criterion (sort)', { type: 'lost', sort: 'relevance' }],
    ['a field that is not a criterion (status)', { type: 'lost', status: 'hidden' }],
    [
      'a field that is not a criterion (owner)',
      { type: 'lost', owner: '650000000000000000000009' },
    ],
    ['a name that is too long', { type: 'lost', name: 'x'.repeat(61) }],
    ['dateTo before dateFrom', { dateFrom: '2026-10-20', dateTo: '2026-10-10' }],
  ])('answers 400 VALIDATION_ERROR for %s', async (label, body) => {
    const { app, savedSearchRepository } = buildApp();

    const res = await post(app, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // an invalid request never reaches the database
    expect(savedSearchRepository.create).not.toHaveBeenCalled();
  });

  it('answers 409 SAVED_SEARCH_LIMIT once the limit is reached', async () => {
    const { app } = buildApp({ maxSaved: 2 });

    await post(app, { type: 'lost' });
    await post(app, { type: 'found' });
    const res = await post(app, { category: 'keys' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SAVED_SEARCH_LIMIT');
  });
});

describe('GET /api/v1/search/saved', () => {
  it('answers 401 without a token', async () => {
    const { app } = buildApp();

    const res = await request(app).get(SAVED);

    expect(res.status).toBe(401);
  });

  it('answers an empty list when nothing is saved', async () => {
    const { app } = buildApp();

    const res = await get(app, SAVED);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('lists the saved searches of the connected user, newest first', async () => {
    const { app } = buildApp();
    await post(app, { name: 'first', type: 'lost' });
    await post(app, { name: 'second', type: 'found' });

    const res = await get(app, SAVED);

    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.name)).toEqual(['second', 'first']);
  });

  it('is not shadowed by GET /:id (saved is not read as an id)', async () => {
    const { app, searchRepository } = buildApp();

    const res = await get(app, SAVED);

    expect(res.status).toBe(200);
    expect(searchRepository.findById).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/search/saved/:id', () => {
  it('answers 401 without a token', async () => {
    const { app } = buildApp();

    const res = await request(app).delete(`${SAVED}/650000000000000000000101`);

    expect(res.status).toBe(401);
  });

  it('deletes my own saved search with 204', async () => {
    const { app, savedSearchRepository } = buildApp();
    const created = await post(app, { type: 'lost' });

    const res = await del(app, `${SAVED}/${created.body.savedSearch.id}`);

    expect(res.status).toBe(204);
    expect(savedSearchRepository.rows).toHaveLength(0);
  });

  it('answers 404 for an id that does not exist', async () => {
    const { app } = buildApp();

    const res = await del(app, `${SAVED}/650000000000000000000999`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 400 for an id that is not a valid id, without querying', async () => {
    const { app, savedSearchRepository } = buildApp();

    const res = await del(app, `${SAVED}/not-an-id`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(savedSearchRepository.deleteByIdAndOwner).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// GET /search/:id
// ---------------------------------------------------------------------------------------------
describe('GET /api/v1/search/:id', () => {
  const URL_OK = `/api/v1/search/${declaration._id}`;

  it('answers 401 without a token', async () => {
    const { app } = buildApp();

    const res = await request(app).get(URL_OK);

    expect(res.status).toBe(401);
  });

  it('answers the declaration in the public shape', async () => {
    const { app, searchRepository } = buildApp();

    const res = await get(app, URL_OK);

    expect(res.status).toBe(200);
    expect(res.body.declaration).toMatchObject({ id: declaration._id, title: 'Black backpack' });
    expect(searchRepository.findById).toHaveBeenCalledWith(declaration._id);
  });

  it('never returns privateInfo or the owner, even to an admin', async () => {
    const { app } = buildApp({ role: 'admin' });

    const res = await get(app, URL_OK);

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret notebook');
    expect(text).not.toContain('privateInfo');
    expect(text).not.toContain('owner');
    expect(text).not.toContain('650000000000000000000009');
  });

  it('answers 404 when the declaration does not exist', async () => {
    const { app } = buildApp({ found: null });

    const res = await get(app, URL_OK);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['hidden', { status: 'hidden' }],
    ['deleted', { status: 'deleted' }],
    ['soft deleted', { deletedAt: new Date() }],
  ])('answers 404 to a user for a %s declaration, 200 to an admin', async (label, change) => {
    const forUser = buildApp({ found: { ...declaration, ...change } });
    const forAdmin = buildApp({ found: { ...declaration, ...change }, role: 'admin' });

    expect((await get(forUser.app, URL_OK)).status).toBe(404);
    expect((await get(forAdmin.app, URL_OK)).status).toBe(200);
  });

  it('answers 400 for an id that is not a valid id, without querying', async () => {
    const { app, searchRepository } = buildApp();

    const res = await get(app, '/api/v1/search/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(searchRepository.findById).not.toHaveBeenCalled();
  });

  it('does not steal /filters from its own route', async () => {
    const { app, searchRepository } = buildApp();

    const res = await get(app, '/api/v1/search/filters');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('locations');
    expect(searchRepository.findById).not.toHaveBeenCalled();
  });
});
