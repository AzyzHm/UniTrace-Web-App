import { registerMatchingListeners } from '../events/matching/matching-listeners.js';
import { MATCHING_EVENTS } from '../events/matching/matching-events.js';
import { createDeclarationGateway } from '../repositories/matching/declaration.gateway.js';
import { createEmbeddingRepository } from '../repositories/matching/embedding.repository.js';
import { createMatchRepository } from '../repositories/matching/match.repository.js';
import { createEmbeddingService } from '../services/matching/embedding.service.js';
import { createMatchingService } from '../services/matching/matching.service.js';

/**
 * Matching domain (binôme 3). Same shape as buildAuth / buildDeclarations:
 * receives { config, common, use } and returns { services }.
 */
export function buildMatching({ config = {}, common, use }) {
  const { logger, clock, eventBus } = common;

  const matchRepository = use('matchRepository', createMatchRepository);
  const embeddingRepository = use('matchingEmbeddingRepository', createEmbeddingRepository);
  const declarationGateway = use('declarationGateway', () => createDeclarationGateway());
  const embeddingService = use('embeddingService', () =>
    createEmbeddingService({
      textModelId: config.matching?.textModel,
      photoModelId: config.matching?.photoModel,
    }),
  );

  // Notifications leave the module as an event; the notification/email domain subscribes to it.
  const notifier = {
    notify: async (n) => {
      const emit = (eventBus.emit ?? eventBus.publish)?.bind(eventBus);
      if (emit) await emit(MATCHING_EVENTS.NOTIFICATION, n);
      else logger.info(`match notification ${n.type} for user ${n.userId}`);
    },
  };

  const matchingService = use('matchingService', () =>
    createMatchingService({
      matchRepository,
      embeddingRepository,
      declarationGateway,
      embeddingService,
      notifier,
      clock,
    }),
  );

  registerMatchingListeners({ eventBus, matchingService, logger });

  return { services: { matchingService } };
}