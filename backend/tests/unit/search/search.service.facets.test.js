/**
 * FICHIER : tests/unit/search/search.service.facets.test.js
 *
 * RÔLE
 *   Vérifie que le service utilise bien searchWithFacets quand ?facets= est demandé,
 *   et qu'il utilise le chemin count + findPage sinon.
 *
 * TESTE
 *   src/services/search/search.service.js
 *
 * COMMENT LE LANCER
 *      npx vitest run tests/unit/search/search.service.facets.test.js
 */
import { describe, expect, it, vi } from 'vitest';
import { createSearchService } from '../../../src/services/search/search.service.js';

// On crée un faux repository pour contrôler les appels
function setup() {
  const searchRepository = {
    count: vi.fn().mockResolvedValue(10),
    findPage: vi.fn().mockResolvedValue([]),
    searchWithFacets: vi.fn().mockResolvedValue({
      total: 10,
      items: [],
      facets: { category: [{ _id: 'wallet_bag', count: 5 }] },
    }),
    topLocations: vi.fn().mockResolvedValue([]),
    topColors: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
  };

  const service = createSearchService({
    searchRepository,
    eventBus: { on: vi.fn() },
  });

  return { service, searchRepository };
}

const fakeUser = { id: 'user1', role: 'user' };

describe('search service - facets', () => {
  it('utilise searchWithFacets quand facets est demandé', async () => {
    const { service, searchRepository } = setup();

    const result = await service.searchDeclarations(fakeUser, {
      facets: ['category'],
      page: 1,
      limit: 20,
      sort: 'date_desc',
    });

    expect(searchRepository.searchWithFacets).toHaveBeenCalledTimes(1);
    expect(searchRepository.count).not.toHaveBeenCalled();
    expect(result.facets).toBeDefined();
  });

  it('utilise count + findPage quand facets n\'est pas demandé', async () => {
    const { service, searchRepository } = setup();

    const result = await service.searchDeclarations(fakeUser, {
      page: 1,
      limit: 20,
      sort: 'date_desc',
    });

    expect(searchRepository.count).toHaveBeenCalledTimes(1);
    expect(searchRepository.findPage).toHaveBeenCalledTimes(1);
    expect(searchRepository.searchWithFacets).not.toHaveBeenCalled();
    expect(result.facets).toBeUndefined();
  });
});