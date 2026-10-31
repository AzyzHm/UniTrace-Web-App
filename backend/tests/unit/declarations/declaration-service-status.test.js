import { describe, expect, it, vi } from 'vitest';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';

const ID = '507f1f77bcf86cd799439055';
const OWNER_ID = '507f1f77bcf86cd799439022';
const OWNER = { _id: OWNER_ID, role: 'user' };
const STRANGER = { _id: '507f1f77bcf86cd799439033', role: 'user' };
const ADMIN = { _id: '507f1f77bcf86cd799439044', role: 'admin' };
const NOW = new Date('2026-10-25T10:00:00Z');

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
  const service = createDeclarationService({
    declarationRepository,
    userRepository,
    eventBus,
    clock: () => NOW,
  });

  return { service, declarationRepository, eventBus };
}

const expectNotFound = (promise) =>
  expect(promise).rejects.toMatchObject({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Declaration not found',
  });

const expectForbidden = (promise) =>
  expect(promise).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

const expectConflict = (promise, message) =>
  expect(promise).rejects.toMatchObject({
    statusCode: 409,
    code: 'CONFLICT',
    ...(message && { message }),
  });

describe('declaration service, changeStatus', () => {
  describe('what does not exist', () => {
    it('answers not found for an unknown id', async () => {
      const { service, declarationRepository } = setup({ found: null });

      await expectNotFound(service.changeStatus(OWNER, ID, 'resolved'));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it.each([
      ['the owner', OWNER],
      ['an admin', ADMIN],
      ['a stranger', STRANGER],
    ])('treats a deleted declaration as missing for %s', async (_who, user) => {
      const { service, declarationRepository } = setup({ found: stored({ status: 'deleted' }) });

      await expectNotFound(service.changeStatus(user, ID, 'pending'));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });
  });

  describe('a stranger', () => {
    it('is refused with 403 on a declaration they can read', async () => {
      const { service, declarationRepository, eventBus } = setup();

      await expectForbidden(service.changeStatus(STRANGER, ID, 'resolved'));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('gets 404, not 403, on a hidden declaration', async () => {
      const { service } = setup({ found: stored({ status: 'hidden' }) });

      await expectNotFound(service.changeStatus(STRANGER, ID, 'pending'));
    });
  });

  describe('the owner', () => {
    it.each([
      ['pending', 'resolved'],
      ['pending', 'deleted'],
      ['matched', 'resolved'],
      ['matched', 'deleted'],
      ['expired', 'pending'],
      ['expired', 'deleted'],
    ])('may move a %s declaration to %s', async (from, to) => {
      const { service, declarationRepository } = setup({ found: stored({ status: from }) });

      await service.changeStatus(OWNER, ID, to);

      expect(declarationRepository.updateFields).toHaveBeenCalledTimes(1);
      expect(declarationRepository.updateFields.mock.calls[0][0]).toBe(ID);
      expect(declarationRepository.updateFields.mock.calls[0][1]).toMatchObject({ status: to });
      // The write repeats the status the decision was based on.
      expect(declarationRepository.updateFields.mock.calls[0][2]).toBe(from);
    });

    it.each([
      ['pending', 'hidden'],
      ['matched', 'hidden'],
      ['resolved', 'pending'],
      ['resolved', 'hidden'],
      ['resolved', 'deleted'],
      ['hidden', 'pending'],
      ['hidden', 'deleted'],
    ])('is refused with 403 for %s to %s, which only an admin can do', async (from, to) => {
      const { service, declarationRepository, eventBus } = setup({
        found: stored({ status: from }),
      });

      await expectForbidden(service.changeStatus(OWNER, ID, to));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it.each([
      ['pending', 'matched'],
      ['pending', 'expired'],
      ['matched', 'pending'],
      ['expired', 'resolved'],
      ['expired', 'matched'],
    ])('is refused with 409 for %s to %s, which nobody can do by hand', async (from, to) => {
      const { service, declarationRepository } = setup({ found: stored({ status: from }) });

      await expectConflict(
        service.changeStatus(OWNER, ID, to),
        `A ${from} declaration cannot become ${to}`,
      );
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it.each(['pending', 'matched', 'resolved', 'expired', 'hidden'])(
      'is refused with 409 when the declaration is already %s',
      async (status) => {
        const { service, declarationRepository } = setup({ found: stored({ status }) });

        await expectConflict(
          service.changeStatus(OWNER, ID, status),
          `The declaration is already ${status}`,
        );
        expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      },
    );

    it('compares the owner as text, whatever the type of the ids', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ owner: { toString: () => OWNER_ID } }),
      });

      await service.changeStatus(OWNER, ID, 'resolved');

      expect(declarationRepository.updateFields).toHaveBeenCalled();
    });
  });

  describe('an admin', () => {
    it.each([
      ['pending', 'resolved'],
      ['pending', 'hidden'],
      ['pending', 'deleted'],
      ['matched', 'resolved'],
      ['matched', 'hidden'],
      ['matched', 'deleted'],
      ['resolved', 'pending'],
      ['resolved', 'hidden'],
      ['resolved', 'deleted'],
      ['expired', 'pending'],
      ['expired', 'deleted'],
    ])('may move a %s declaration they do not own to %s', async (from, to) => {
      const { service, declarationRepository } = setup({ found: stored({ status: from }) });

      await service.changeStatus(ADMIN, ID, to);

      expect(declarationRepository.updateFields.mock.calls[0][1]).toMatchObject({ status: to });
      expect(declarationRepository.updateFields.mock.calls[0][2]).toBe(from);
    });

    it.each([
      ['pending', 'matched'],
      ['pending', 'expired'],
      ['matched', 'pending'],
      ['resolved', 'expired'],
      ['resolved', 'matched'],
      ['expired', 'resolved'],
    ])('is refused with 409 for %s to %s, which is set by the system only', async (from, to) => {
      const { service, declarationRepository } = setup({ found: stored({ status: from }) });

      await expectConflict(service.changeStatus(ADMIN, ID, to));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it('announces the owner of the declaration, not the admin, with the role as actor', async () => {
      const { service, eventBus } = setup();

      await service.changeStatus(ADMIN, ID, 'hidden');

      expect(eventBus.emit).toHaveBeenCalledWith('declaration.statusChanged', {
        declarationId: ID,
        ownerId: OWNER_ID,
        from: 'pending',
        to: 'hidden',
        actor: 'admin',
      });
    });

    it('acts as an admin on their own declaration too', async () => {
      const { service, eventBus } = setup({ found: stored({ owner: ADMIN._id }) });

      await service.changeStatus(ADMIN, ID, 'hidden');

      expect(eventBus.emit.mock.calls[0][1]).toMatchObject({ actor: 'admin' });
    });
  });

  describe('hiding and restoring', () => {
    it.each(['pending', 'matched', 'resolved'])(
      'remembers a %s declaration was %s when it is hidden',
      async (from) => {
        const { service, declarationRepository } = setup({ found: stored({ status: from }) });

        await service.changeStatus(ADMIN, ID, 'hidden');

        expect(declarationRepository.updateFields).toHaveBeenCalledWith(
          ID,
          { status: 'hidden', statusBeforeHidden: from },
          from,
        );
      },
    );

    it.each(['pending', 'matched', 'resolved'])(
      'restores a hidden declaration to %s and forgets where it came from',
      async (before) => {
        const { service, declarationRepository } = setup({
          found: stored({ status: 'hidden', statusBeforeHidden: before }),
        });

        await service.changeStatus(ADMIN, ID, before);

        expect(declarationRepository.updateFields).toHaveBeenCalledWith(
          ID,
          { status: before, statusBeforeHidden: null },
          'hidden',
        );
      },
    );

    it('refuses to restore a hidden declaration anywhere but where it came from', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ status: 'hidden', statusBeforeHidden: 'resolved' }),
      });

      await expectConflict(
        service.changeStatus(ADMIN, ID, 'pending'),
        'A hidden declaration can only be restored to resolved',
      );
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it('lets an admin delete a hidden declaration, whatever it was before', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ status: 'hidden', statusBeforeHidden: 'resolved' }),
      });

      await service.changeStatus(ADMIN, ID, 'deleted');

      expect(declarationRepository.updateFields.mock.calls[0][1]).toMatchObject({
        status: 'deleted',
        statusBeforeHidden: null,
      });
    });

    it('accepts any restore target when nothing was remembered', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ status: 'hidden', statusBeforeHidden: null }),
      });

      await service.changeStatus(ADMIN, ID, 'pending');

      expect(declarationRepository.updateFields.mock.calls[0][1]).toMatchObject({
        status: 'pending',
      });
    });
  });

  describe('what is written', () => {
    it('writes only the status and a cleared statusBeforeHidden for an ordinary move', async () => {
      const { service, declarationRepository } = setup();

      await service.changeStatus(OWNER, ID, 'resolved');

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { status: 'resolved', statusBeforeHidden: null },
        'pending',
      );
    });

    it('stamps deletedAt and erases privateInfo when it deletes', async () => {
      const { service, declarationRepository } = setup();

      await service.changeStatus(OWNER, ID, 'deleted');

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { status: 'deleted', statusBeforeHidden: null, deletedAt: NOW, privateInfo: null },
        'pending',
      );
    });

    it('never touches privateInfo or deletedAt for a move that is not a delete', async () => {
      const { service, declarationRepository } = setup();

      await service.changeStatus(OWNER, ID, 'resolved');

      const written = declarationRepository.updateFields.mock.calls[0][1];
      expect(written).not.toHaveProperty('privateInfo');
      expect(written).not.toHaveProperty('deletedAt');
    });

    it('returns what the write returns', async () => {
      const updated = { _id: ID, status: 'resolved' };
      const { service } = setup({ updated });

      await expect(service.changeStatus(OWNER, ID, 'resolved')).resolves.toBe(updated);
    });
  });

  describe('the event', () => {
    it('is emitted after a successful move, with the role of the actor', async () => {
      const { service, eventBus } = setup();

      await service.changeStatus(OWNER, ID, 'resolved');

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('declaration.statusChanged', {
        declarationId: ID,
        ownerId: OWNER_ID,
        from: 'pending',
        to: 'resolved',
        actor: 'user',
      });
    });

    it('is not emitted when a refused move writes nothing', async () => {
      const { service, eventBus } = setup({ found: stored({ status: 'resolved' }) });

      await expectForbidden(service.changeStatus(OWNER, ID, 'pending'));
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('when the status moves between the read and the write', () => {
    it('answers 409, writes nothing more and emits nothing', async () => {
      const { service, declarationRepository, eventBus } = setup({ updated: null });

      await expectConflict(
        service.changeStatus(OWNER, ID, 'resolved'),
        'The declaration changed in the meantime, please reload it',
      );
      expect(declarationRepository.updateFields).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});

describe('declaration service, remove', () => {
  it('is a move to deleted, with the same write and the same event', async () => {
    const { service, declarationRepository, eventBus } = setup();

    await service.remove(OWNER, ID);

    expect(declarationRepository.updateFields).toHaveBeenCalledWith(
      ID,
      { status: 'deleted', statusBeforeHidden: null, deletedAt: NOW, privateInfo: null },
      'pending',
    );
    expect(eventBus.emit).toHaveBeenCalledWith('declaration.statusChanged', {
      declarationId: ID,
      ownerId: OWNER_ID,
      from: 'pending',
      to: 'deleted',
      actor: 'user',
    });
  });

  it.each(['pending', 'matched', 'expired'])(
    'lets the owner delete a %s declaration',
    async (status) => {
      const { service, declarationRepository } = setup({ found: stored({ status }) });

      await service.remove(OWNER, ID);

      expect(declarationRepository.updateFields).toHaveBeenCalled();
    },
  );

  it.each(['resolved', 'hidden'])(
    'refuses the owner on a %s declaration with 403',
    async (status) => {
      const { service, declarationRepository } = setup({ found: stored({ status }) });

      await expectForbidden(service.remove(OWNER, ID));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'matched', 'resolved', 'expired', 'hidden'])(
    'lets an admin delete a %s declaration',
    async (status) => {
      const { service, declarationRepository } = setup({ found: stored({ status }) });

      await service.remove(ADMIN, ID);

      expect(declarationRepository.updateFields.mock.calls[0][1]).toMatchObject({
        status: 'deleted',
      });
    },
  );

  it('answers not found the second time', async () => {
    const { service } = setup({ found: stored({ status: 'deleted' }) });

    await expectNotFound(service.remove(OWNER, ID));
  });

  it('refuses a stranger with 403, and with 404 on a hidden declaration', async () => {
    await expectForbidden(setup().service.remove(STRANGER, ID));
    await expectNotFound(
      setup({ found: stored({ status: 'hidden' }) }).service.remove(STRANGER, ID),
    );
  });
});
