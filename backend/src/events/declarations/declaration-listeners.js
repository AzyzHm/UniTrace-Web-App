import { EVENTS } from '../../constants/common/events.js';

export function registerDeclarationListeners({ eventBus, declarationCleanupService }) {
  const offs = [
    // The users domain only announces that an account was deleted. Cleaning the declarations is
    // decided here, so the users code never has to know about declarations.
    eventBus.on(EVENTS.USER_DELETED, (payload) =>
      declarationCleanupService.handleOwnerDeleted(payload),
    ),
  ];

  // Returned so tests can detach the listeners.
  return () => offs.forEach((off) => off());
}
