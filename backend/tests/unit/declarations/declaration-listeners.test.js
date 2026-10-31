import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { registerDeclarationListeners } from '../../../src/events/declarations/declaration-listeners.js';
import { createEventBus } from '../../../src/events/common/event-bus.js';

describe('declaration listeners', () => {
  it('sends user.deleted to the cleanup service with the same payload', async () => {
    const eventBus = createEventBus();
    const declarationCleanupService = { handleOwnerDeleted: vi.fn().mockResolvedValue(undefined) };
    registerDeclarationListeners({ eventBus, declarationCleanupService });
    const payload = { userId: 'u1', deletedAt: new Date() };

    await eventBus.emit(EVENTS.USER_DELETED, payload);

    expect(declarationCleanupService.handleOwnerDeleted).toHaveBeenCalledWith(payload);
  });

  it('stops listening once the returned function is called', async () => {
    const eventBus = createEventBus();
    const declarationCleanupService = { handleOwnerDeleted: vi.fn() };
    const off = registerDeclarationListeners({ eventBus, declarationCleanupService });

    off();
    await eventBus.emit(EVENTS.USER_DELETED, { userId: 'u1' });

    expect(declarationCleanupService.handleOwnerDeleted).not.toHaveBeenCalled();
  });

  it('does not let a failing cleanup break the emit', async () => {
    const logger = { error: vi.fn() };
    const eventBus = createEventBus({ logger });
    const declarationCleanupService = {
      handleOwnerDeleted: vi.fn().mockRejectedValue(new Error('boom')),
    };
    registerDeclarationListeners({ eventBus, declarationCleanupService });

    await expect(eventBus.emit(EVENTS.USER_DELETED, { userId: 'u1' })).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
