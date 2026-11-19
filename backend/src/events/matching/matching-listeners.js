import { EVENTS } from '../../constants/common/events.js';

export function registerMatchingListeners({ eventBus, matchingService, correspondenceService, logger }) {
  // eventBus.emit is awaited and the embedding model takes seconds. The job is started and NOT
  // awaited, so POST /declarations answers at once. Errors are logged here.
  const background = (label, job) => {
    job().catch((err) => logger.error({ err }, `Matching failed: ${label}`));
  };

  const offs = [
    eventBus.on(EVENTS.DECLARATION_CREATED, ({ declarationId }) =>
      background('created', () => matchingService.findMatches(declarationId)),
    ),
    eventBus.on(EVENTS.DECLARATION_UPDATED, ({ declarationId, changedFields }) =>
      background('updated', () => correspondenceService.onDeclarationChanged({ declarationId, changedFields })),
    ),
    // Hidden, deleted, resolved, restored... The service reads the new status itself.
    eventBus.on(EVENTS.DECLARATION_STATUS_CHANGED, ({ declarationId }) =>
      background('status', () =>
        correspondenceService.onDeclarationChanged({ declarationId, changedFields: ['status'] }),
      ),
    ),
  ];

  return () => offs.forEach((off) => off());
}