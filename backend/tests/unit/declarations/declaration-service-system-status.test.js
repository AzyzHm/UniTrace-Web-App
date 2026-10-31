import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';

const ID = '507f1f77bcf86cd799439055';
const OWNER_ID = '507f1f77bcf86cd799439022';

const stored = (overrides = {}) => ({
  _id: ID,
  owner: OWNER_ID,
  status: 'pending',
  statusBeforeHidden: null,
  title: 'Black backpack',
  ...overrides,
});

function setup({ found = stored(), updated } = {}) {
  const declarationRepository = {
    findById: vi.fn().mockResolvedValue(found),
    updateFields: vi.fn().mockResolvedValue(updated === undefined ? { _id: ID } : updated),
  };
  const userRepository = { findById: vi.fn() };
  const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
  const service = createDeclarationService({ declarationRepository, userRepository, eventBus });

  return { service, declarationRepository, eventBus };
}

const expectConflict = (promise, message) =>
  expect(promise).rejects.toMatchObject({
    statusCode: 409,
    code: 'CONFLICT',
    ...(message && { message }),
  });

describe('declaration service, changeStatusAsSystem', () => {
  describe('the moves the system may make', () => {
    it.each([
      ['pending', 'matched'],
      ['pending', 'expired'],
      ['matched', 'pending'],
    ])('moves a %s declaration to %s', async (from, to) => {
      const { service, declarationRepository } = setup({ found: stored({ status: from }) });

      const result = await service.changeStatusAsSystem(ID, to);

      expect(result).toEqual({ _id: ID });
      // The write repeats the status the decision was based on.
      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { status: to, statusBeforeHidden: null },
        from,
      );
    });

    it('announces the move with the system as actor and the given reason', async () => {
      const { service, eventBus } = setup();

      await service.changeStatusAsSystem(ID, 'matched', { reason: 'match_found' });

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(EVENTS.DECLARATION_STATUS_CHANGED, {
        declarationId: ID,
        ownerId: OWNER_ID,
        from: 'pending',
        to: 'matched',
        actor: 'system',
        reason: 'match_found',
      });
    });

    it('leaves "reason" out of the event when none is given', async () => {
      const { service, eventBus } = setup();

      await service.changeStatusAsSystem(ID, 'expired');

      expect(eventBus.emit).toHaveBeenCalledWith(EVENTS.DECLARATION_STATUS_CHANGED, {
        declarationId: ID,
        ownerId: OWNER_ID,
        from: 'pending',
        to: 'expired',
        actor: 'system',
      });
    });

    it('needs no user: nothing asks who is calling', async () => {
      const { service } = setup();

      await expect(service.changeStatusAsSystem(ID, 'matched')).resolves.toBeDefined();
    });
  });

  describe('what the system may not touch', () => {
    it('answers not found for an unknown id', async () => {
      const { service, declarationRepository, eventBus } = setup({ found: null });

      await expect(service.changeStatusAsSystem(ID, 'matched')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('answers not found for a deleted declaration', async () => {
      const { service, declarationRepository } = setup({ found: stored({ status: 'deleted' }) });

      await expect(service.changeStatusAsSystem(ID, 'pending')).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it('refuses a move that changes nothing', async () => {
      const { service, declarationRepository } = setup({ found: stored({ status: 'matched' }) });

      await expectConflict(
        service.changeStatusAsSystem(ID, 'matched'),
        'The declaration is already matched',
      );
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it.each([
      ['pending', 'resolved'],
      ['pending', 'hidden'],
      ['pending', 'deleted'],
      ['matched', 'resolved'],
      ['matched', 'hidden'],
      ['matched', 'deleted'],
      ['matched', 'expired'],
      ['resolved', 'pending'],
      ['resolved', 'matched'],
      ['resolved', 'hidden'],
      ['expired', 'pending'],
      ['expired', 'matched'],
      ['hidden', 'pending'],
      ['hidden', 'matched'],
      ['hidden', 'deleted'],
    ])('refuses to move a %s declaration to %s, and writes nothing', async (from, to) => {
      const { service, declarationRepository, eventBus } = setup({
        found: stored({ status: from, statusBeforeHidden: from === 'hidden' ? 'pending' : null }),
      });

      await expectConflict(
        service.changeStatusAsSystem(ID, to),
        `The system cannot change a ${from} declaration to ${to}`,
      );
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('refuses a status that does not exist', async () => {
      const { service, declarationRepository } = setup();

      await expectConflict(service.changeStatusAsSystem(ID, 'archived'));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });
  });

  describe('when the status moves in the meantime', () => {
    it('answers 409 and announces nothing when the write finds another status', async () => {
      const { service, eventBus } = setup({ updated: null });

      await expectConflict(
        service.changeStatusAsSystem(ID, 'matched'),
        'The declaration changed in the meantime, please reload it',
      );
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
