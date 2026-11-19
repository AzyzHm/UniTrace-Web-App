import { registerMatchingListeners } from '../events/matching/matching-listeners.js';
import { createMatchingRepository } from '../repositories/matching/matching.repository.js';
import { createNotificationRepository } from '../repositories/notifications/notification.repository.js';
import { createCorrespondenceService } from '../services/matching/correspondence.service.js';
import { createEmbeddingService } from '../services/matching/embedding.service.js';
import { createMatchingService } from '../services/matching/matching.service.js';
import { createNotificationService } from '../services/notifications/notification.service.js';

export function buildMatching({ common, declarations, use }) {
  const { logger, eventBus, userRepository } = common;
  const { declarationService } = declarations.services;

  const matchingRepository = use('matchingRepository', createMatchingRepository);
  const notificationRepository = use('notificationRepository', createNotificationRepository);

  const embeddingService = use('embeddingService', () =>
    createEmbeddingService({ pictureStorage: declarations.pictureStorage, logger }),
  );
  const notificationService = use('notificationService', () =>
    createNotificationService({ notificationRepository, logger }),
  );

  const matchingService = createMatchingService({ matchingRepository, embeddingService, notificationService, logger });
  const correspondenceService = createCorrespondenceService({
    matchingRepository,
    matchingService,
    notificationService,
    declarationService,
    userRepository,
    logger,
  });

  registerMatchingListeners({ eventBus, matchingService, correspondenceService, logger });

  return { services: { matchingService, correspondenceService, notificationService }, embeddingService };
}