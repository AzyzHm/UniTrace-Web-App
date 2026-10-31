import { registerDeclarationListeners } from '../events/declarations/declaration-listeners.js';
import { createDeclarationRepository } from '../repositories/declarations/declaration.repository.js';
import { createDeclarationCleanupService } from '../services/declarations/declaration-cleanup.service.js';
import { createDeclarationService } from '../services/declarations/declaration.service.js';
import { createPictureStorage } from '../services/declarations/picture-storage.js';

export function buildDeclarations({ config, common, use }) {
  const { logger, eventBus, userRepository } = common;

  const declarationRepository = use('declarationRepository', createDeclarationRepository);

  const pictureStorage = use('pictureStorage', () =>
    createPictureStorage({ dir: config.uploadDir, logger }),
  );

  // Registered here, once, because the listener needs the cleanup service built in this file. The
  // cleanup service gets the picture storage so the image files disappear with the account.
  registerDeclarationListeners({
    eventBus,
    declarationCleanupService: createDeclarationCleanupService({
      declarationRepository,
      eventBus,
      pictureStorage,
    }),
  });

  const services = {
    declarationService: createDeclarationService({
      declarationRepository,
      userRepository,
      eventBus,
      pictureStorage,
    }),
  };

  return { services, declarationRepository, pictureStorage };
}
