import { DECLARATION_EVENTS } from './matching-events.js';

// Payloads may carry the id in several shapes: be tolerant, adjust once the real events are known.
const declarationIdOf = (p) =>
  String(p?.declarationId ?? p?.declaration?._id ?? p?.declaration?.id ?? p?.id ?? p?._id ?? '') || null;
const actorIdOf = (p) => p?.actorId ?? p?.userId ?? p?.owner ?? null;
const userIdOf = (p) => String(p?.userId ?? p?.id ?? p?._id ?? p?.user?._id ?? p?.user?.id ?? '') || null;

/**
 * Subscribes the matching service to the declaration events, so that binôme 1
 * and binôme 4 do not have to call it. The bus API is read as on(event, handler)
 * (or subscribe); a failing matching must never break the declaration request, so
 * every handler catches and logs.
 */
export function registerMatchingListeners({ eventBus, matchingService, logger, events = DECLARATION_EVENTS }) {
  const subscribe = (eventBus.on ?? eventBus.subscribe)?.bind(eventBus);
  if (!subscribe) {
    logger.warn('Matching: the event bus has no on()/subscribe(); matching will not react to declaration events');
    return;
  }

  const safe = (name, fn) =>
    subscribe(name, async (payload) => {
      try {
        await fn(payload);
      } catch (err) {
        logger.error(`Matching failed on "${name}": ${err.message}`);
      }
    });

  const withId = (fn) => (p) => {
    const id = declarationIdOf(p);
    return id ? fn(id, p) : undefined;
  };

  safe(events.created, withId((id) => matchingService.onDeclarationCreated(id)));
  safe(events.updated, withId((id, p) => matchingService.onDeclarationUpdated(id, { actorId: actorIdOf(p) })));
  safe(events.deleted, withId((id) => matchingService.onDeclarationRemoved(id, 'declaration_deleted')));
  safe(events.hidden, withId((id) => matchingService.onDeclarationRemoved(id, 'declaration_hidden')));
  safe(events.restored, withId((id) => matchingService.onDeclarationRestored(id)));
  safe(events.userDeleted, (p) => {
    const id = userIdOf(p);
    return id ? matchingService.onUserRemoved(id) : undefined;
  });
}