/**
 * FICHIER : tests/unit/search/search-service.test.js
 *
 * RÔLE
 *   Teste les règles du service de recherche avec un FAUX repository.
 *   Statuts par défaut, droits admin/non-admin, texte court ignoré, pertinence sans texte, pagination, repli du lieu, cache des filtres et vidage par événements.
 *
 * TESTE
 *   src/services/search/search.service.js
 *
 * UTILISE
 *   vitest (describe/it/expect).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/tests.search/unit/search/search-service.test.js
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../../src/constants/common/events.js';
import { createEventBus } from '../../../../src/events/common/event-bus.js';
import { createSearchService } from '../../../../src/services/search/search.service.js';

const user = { id: 'u1', role: 'user' };
const admin = { id: 'a1', role: 'admin' };
const BASE = { sort: 'date_desc', page: 1, limit: 20 };

function build({ total = 0, items = [], cacheTtlMs, clock } = {}) {
  const searchRepository = {
    count: vi.fn().mockResolvedValue(total),
    findPage: vi.fn().mockResolvedValue(items),
    topLocations: vi.fn().mockResolvedValue(['Library', 'Amphi B']),
    topColors: vi.fn().mockResolvedValue(['white', 'black']),
  };
  const eventBus = createEventBus();
  const service = createSearchService({ searchRepository, eventBus, cacheTtlMs, clock });
  return { service, searchRepository, eventBus };
}

describe('searchDeclarations', () => {
  it('searches the active statuses by default, newest first', async () => {
    const { service, searchRepository } = build({ total: 45, items: [{ _id: 1 }] });

    const result = await service.searchDeclarations(user, BASE);

    expect(searchRepository.count.mock.calls[0][0].status).toEqual({
      $in: ['pending', 'matched'],
    });
    expect(searchRepository.findPage.mock.calls[0][1]).toMatchObject({
      sortField: 'date',
      direction: -1,
      skip: 0,
      limit: 20,
      byRelevance: false,
    });
    expect(result.sort).toEqual({ field: 'date', order: 'desc' });
    expect(result.appliedFilters.status).toEqual(['pending', 'matched']);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    });
    expect(result.noResults).toBe(false);
  });

  it.each(['hidden', 'deleted'])('refuses the %s status to a non-admin', async (status) => {
    const { service, searchRepository } = build();

    await expect(
      service.searchDeclarations(user, { ...BASE, status: ['pending', status] }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'STATUS_FORBIDDEN' });
    expect(searchRepository.count).not.toHaveBeenCalled();
  });

  it('lets an admin search hidden and deleted declarations', async () => {
    const { service, searchRepository } = build({ total: 1, items: [{}] });

    await service.searchDeclarations(admin, { ...BASE, status: ['hidden', 'deleted'] });

    expect(searchRepository.count.mock.calls[0][0].status).toEqual({
      $in: ['hidden', 'deleted'],
    });
  });

  it('allows resolved and expired to everyone', async () => {
    const { service } = build();

    await expect(
      service.searchDeclarations(user, { ...BASE, status: ['resolved', 'expired'] }),
    ).resolves.toBeDefined();
  });

  describe('text query', () => {
    it('refuses relevance without q', async () => {
      const { service } = build();

      await expect(
        service.searchDeclarations(user, { ...BASE, sort: 'relevance' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'RELEVANCE_REQUIRES_Q' });
    });

    it('ignores a q that is too short, then relevance is refused too', async () => {
      const { service } = build();

      const result = await service.searchDeclarations(user, { ...BASE, q: ' a ' });
      expect(result.appliedFilters.q).toBeNull();

      await expect(
        service.searchDeclarations(user, { ...BASE, q: 'a', sort: 'relevance' }),
      ).rejects.toMatchObject({ code: 'RELEVANCE_REQUIRES_Q' });
    });

    it('sorts by text score when relevance is asked with a q', async () => {
      const { service, searchRepository } = build({ total: 1, items: [{}] });

      await service.searchDeclarations(user, { ...BASE, q: 'sac noir', sort: 'relevance' });

      expect(searchRepository.count.mock.calls[0][0].$text).toEqual({ $search: 'sac noir' });
      expect(searchRepository.findPage.mock.calls[0][1].byRelevance).toBe(true);
    });
  });

  describe('pagination', () => {
    it('returns an empty page, without a second query, after the last page', async () => {
      const { service, searchRepository } = build({ total: 25 });

      const result = await service.searchDeclarations(user, { ...BASE, page: 5 });

      expect(searchRepository.findPage).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.noResults).toBe(false);
      expect(result.pagination).toMatchObject({ total: 25, hasNext: false, hasPrev: true });
    });

    it('computes the offset from page and limit', async () => {
      const { service, searchRepository } = build({ total: 100, items: [{}] });

      await service.searchDeclarations(user, {
        ...BASE,
        page: 3,
        limit: 10,
        sort: 'createdAt_asc',
      });

      expect(searchRepository.findPage.mock.calls[0][1]).toMatchObject({
        skip: 20,
        limit: 10,
        sortField: 'createdAt',
        direction: 1,
      });
    });

    it('flags an empty result', async () => {
      const { service } = build({ total: 0 });

      const result = await service.searchDeclarations(user, BASE);

      expect(result).toMatchObject({
        items: [],
        noResults: true,
        pagination: { total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      });
    });
  });

  describe('location', () => {
    it('falls back to a loose match when the exact one finds nothing', async () => {
      const { service, searchRepository } = build();
      searchRepository.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
      searchRepository.findPage.mockResolvedValue([{}, {}, {}]);

      const result = await service.searchDeclarations(user, { ...BASE, location: 'bibliotheque' });

      expect(searchRepository.count.mock.calls[0][0].location).toBe('bibliotheque');
      expect(searchRepository.count.mock.calls[1][0].location).toHaveProperty('$regex');
      expect(searchRepository.findPage.mock.calls[0][0].location).toHaveProperty('$regex');
      expect(result.appliedFilters.location).toBe('bibliotheque');
      expect(result.pagination.total).toBe(3);
    });

    it('does not try again when the exact match finds something', async () => {
      const { service, searchRepository } = build({ total: 2, items: [{}, {}] });

      await service.searchDeclarations(user, { ...BASE, location: 'Library' });

      expect(searchRepository.count).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getFilters', () => {
  let ctx;
  beforeEach(() => {
    ctx = build();
  });

  it('lists types, categories and statuses with French labels', async () => {
    const filters = await ctx.service.getFilters(user);

    expect(filters.type).toEqual([
      { key: 'lost', label: 'Perdu' },
      { key: 'found', label: 'Trouvé' },
    ]);
    expect(filters.categories).toHaveLength(14);
    expect(filters.categories[0]).toEqual({ key: 'phone', label: 'Téléphone' });
    expect(filters.hasPhoto).toEqual([
      { key: true, label: 'Avec photo' },
      { key: false, label: 'Sans photo' },
    ]);
  });

  it('sorts the locations and colors that come from the data', async () => {
    const filters = await ctx.service.getFilters(user);

    expect(filters.locations).toEqual([
      { key: 'Amphi B', label: 'Amphi B' },
      { key: 'Library', label: 'Library' },
    ]);
    expect(filters.colors).toEqual(['black', 'white']);
  });

  it('shows hidden and deleted to an admin only', async () => {
    const forUser = (await ctx.service.getFilters(user)).statuses.map((s) => s.key);
    const forAdmin = (await ctx.service.getFilters(admin)).statuses.map((s) => s.key);

    expect(forUser).toEqual(['pending', 'matched', 'resolved', 'expired']);
    expect(forAdmin).toEqual(['pending', 'matched', 'resolved', 'expired', 'hidden', 'deleted']);
  });

  it('queries the database once for two calls of the same role', async () => {
    await ctx.service.getFilters(user);
    await ctx.service.getFilters({ id: 'u2', role: 'user' });

    expect(ctx.searchRepository.topLocations).toHaveBeenCalledTimes(1);
  });

  it('shares one computation between requests that arrive together', async () => {
    await Promise.all([ctx.service.getFilters(user), ctx.service.getFilters(user)]);

    expect(ctx.searchRepository.topLocations).toHaveBeenCalledTimes(1);
  });

  it('keeps a separate answer per role', async () => {
    await ctx.service.getFilters(user);
    await ctx.service.getFilters(admin);

    expect(ctx.searchRepository.topLocations).toHaveBeenCalledTimes(2);
  });

  it('computes again after the cache lifetime', async () => {
    let now = Date.parse('2026-10-31T10:00:00Z');
    ctx = build({ cacheTtlMs: 5 * 60 * 1000, clock: () => new Date(now) });

    await ctx.service.getFilters(user);
    now += 4 * 60 * 1000;
    await ctx.service.getFilters(user);
    expect(ctx.searchRepository.topLocations).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 1000;
    await ctx.service.getFilters(user);
    expect(ctx.searchRepository.topLocations).toHaveBeenCalledTimes(2);
  });

  it.each([
    EVENTS.DECLARATION_CREATED,
    EVENTS.DECLARATION_UPDATED,
    EVENTS.DECLARATION_STATUS_CHANGED,
    EVENTS.USER_DELETED,
  ])('empties the cache on %s', async (event) => {
    await ctx.service.getFilters(user);
    await ctx.eventBus.emit(event, {});
    await ctx.service.getFilters(user);

    expect(ctx.searchRepository.topLocations).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failure', async () => {
    ctx.searchRepository.topLocations.mockRejectedValueOnce(new Error('mongo down'));

    await expect(ctx.service.getFilters(user)).rejects.toThrow('mongo down');
    await expect(ctx.service.getFilters(user)).resolves.toBeDefined();
  });
});
