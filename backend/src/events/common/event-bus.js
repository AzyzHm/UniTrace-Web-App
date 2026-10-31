// Default logger so the bus also works in tests that do not provide one.
const silentLogger = { error() {} };

export function createEventBus({ logger = silentLogger } = {}) {
  const handlersByEvent = new Map();

  return {
    on(event, handler) {
      // Refuse a bad handler now, instead of failing later when the event is emitted.
      if (typeof handler !== 'function') {
        throw new TypeError('eventBus.on(): handler must be a function');
      }
      // A new array is stored instead of pushing into the old one, so an emit already running
      // keeps the list it started with when a listener subscribes or unsubscribes meanwhile.
      const handlers = handlersByEvent.get(event) ?? [];
      handlersByEvent.set(event, [...handlers, handler]);

      return () => {
        const remaining = (handlersByEvent.get(event) ?? []).filter((h) => h !== handler);
        handlersByEvent.set(event, remaining);
      };
    },

    // Awaited, so the caller (and the tests) know every listener has finished.
    async emit(event, payload) {
      const handlers = handlersByEvent.get(event) ?? [];

      await Promise.all(
        handlers.map(async (handler) => {
          try {
            await handler(payload);
          } catch (err) {
            // A broken listener is logged and swallowed: it must never make the code that
            // emitted the event fail (for example the account deletion itself).
            logger.error({ err, event }, 'Event handler failed');
          }
        }),
      );
    },
  };
}
