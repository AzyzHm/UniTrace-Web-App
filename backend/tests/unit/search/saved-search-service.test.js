/**
 * FICHIER : tests/unit/search/saved-search-service.test.js
 *
 * RÔLE
 *   Teste les règles métier des recherches sauvegardées avec un faux repository : limite par
 *   utilisateur, séparation des propriétaires, 404 (jamais 403), nettoyage à la suppression d'un
 *   compte. Ne nécessite pas MongoDB.
 *
 * TESTE
 *   services/search/saved-search.service.js
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/saved-search-service.test.js
 */
import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { createEventBus } from '../../../src/events/common/event-bus.js';
import { createSavedSearchService } from '../../../src/services/search/saved-search.service.js';

const user = { id: 'u1', role: 'user' };

function build({ count = 0, deleted = true, maxPerUser } = {}) {
  const savedSearchRepository = {
    create: vi.fn(async (data) => ({ _id: 's1', ...data })),
    listByOwner: vi.fn().mockResolvedValue([{ _id: 's1' }]),
    countByOwner: vi.fn().mockResolvedValue(count),
    deleteByIdAndOwner: vi.fn().mockResolvedValue(deleted),
    deleteAllByOwner: vi.fn().mockResolvedValue(3),
  };
  const eventBus = createEventBus();
  const service = createSavedSearchService({ savedSearchRepository, eventBus, maxPerUser });
  return { service, savedSearchRepository, eventBus };
}

describe('save', () => {
  it('stores the criteria for the connected user and separates the name', async () => {
    const { service, savedSearchRepository } = build();

    await service.save(user, { name: 'Bag', q: 'sac', type: 'lost' });

    expect(savedSearchRepository.create).toHaveBeenCalledWith({
      owner: 'u1',
      name: 'Bag',
      criteria: { q: 'sac', type: 'lost' },
    });
  });

  it('keeps the name null when none is given', async () => {
    const { service, savedSearchRepository } = build();

    await service.save(user, { type: 'found' });

    expect(savedSearchRepository.create.mock.calls[0][0]).toMatchObject({ name: null });
  });

  it('uses _id when the user is a Mongoose document', async () => {
    const { service, savedSearchRepository } = build();

    await service.save({ _id: 'objectId', id: 'string', role: 'user' }, { type: 'lost' });

    expect(savedSearchRepository.create.mock.calls[0][0].owner).toBe('objectId');
  });

  it('refuses a new one at the limit, without writing', async () => {
    const { service, savedSearchRepository } = build({ count: 20 });

    await expect(service.save(user, { type: 'lost' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SAVED_SEARCH_LIMIT',
    });
    expect(savedSearchRepository.create).not.toHaveBeenCalled();
  });

  it('allows the last free slot', async () => {
    const { service } = build({ count: 19 });

    await expect(service.save(user, { type: 'lost' })).resolves.toBeDefined();
  });

  it('uses the limit it is given', async () => {
    const { service } = build({ count: 2, maxPerUser: 2 });

    await expect(service.save(user, { type: 'lost' })).rejects.toMatchObject({
      code: 'SAVED_SEARCH_LIMIT',
    });
  });
});

describe('list', () => {
  it('asks only for the searches of the connected user', async () => {
    const { service, savedSearchRepository } = build();

    const result = await service.list(user);

    expect(savedSearchRepository.listByOwner).toHaveBeenCalledWith('u1');
    expect(result).toEqual([{ _id: 's1' }]);
  });
});

describe('remove', () => {
  it('deletes by id AND owner', async () => {
    const { service, savedSearchRepository } = build();

    await service.remove(user, 's1');

    expect(savedSearchRepository.deleteByIdAndOwner).toHaveBeenCalledWith('s1', 'u1');
  });

  it('answers NOT_FOUND (never FORBIDDEN) when it does not exist or belongs to someone else', async () => {
    const { service } = build({ deleted: false });

    await expect(service.remove(user, 's1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('account deletion', () => {
  it('removes every saved search of a deleted user', async () => {
    const { savedSearchRepository, eventBus } = build();

    await eventBus.emit(EVENTS.USER_DELETED, { userId: 'u9', deletedAt: new Date() });

    expect(savedSearchRepository.deleteAllByOwner).toHaveBeenCalledWith('u9');
  });

  it('works without an event bus', () => {
    expect(() =>
      createSavedSearchService({ savedSearchRepository: {}, eventBus: undefined }),
    ).not.toThrow();
  });
});
