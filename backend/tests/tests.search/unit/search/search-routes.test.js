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

function buildApp({ limits, role = 'user' } = {}) {
  const searchRepository = {
    count: vi.fn().mockResolvedValue(1),
    findPage: vi.fn().mockResolvedValue([declaration]),
    topLocations: vi.fn().mockResolvedValue(['Library']),
    topColors: vi.fn().mockResolvedValue(['black']),
  };
  const requireAuth = (req, res, next) => {
    if (!req.get('Authorization')) throw new UnauthenticatedError();
    req.user = { id: 'u1', role };
    next();
  };
  const app = createApp({
    // The users routes are mounted whenever requireAuth is given, and need their services.
    profileService: {},
    passwordChangeService: {},
    accountDeletionService: {},
    searchService: createSearchService({ searchRepository }),
    requireAuth,
    rateLimiters: limits ? createRateLimiters({ limits }) : null,
  });
  return { app, searchRepository };
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
