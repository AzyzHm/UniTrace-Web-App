import { describe, expect, it, vi } from 'vitest';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';

const ID = '507f1f77bcf86cd799439055';
const OWNER_ID = '507f1f77bcf86cd799439022';
const OWNER = { _id: OWNER_ID, role: 'user' };
const STRANGER = { _id: '507f1f77bcf86cd799439033', role: 'user' };
const ADMIN = { _id: '507f1f77bcf86cd799439044', role: 'admin' };

const stored = (overrides = {}) => ({
  _id: ID,
  owner: OWNER_ID,
  status: 'pending',
  title: 'Black backpack',
  description: 'Black Nike backpack with a red keychain.',
  date: new Date('2026-10-12T00:00:00Z'),
  location: 'Main library, 2nd floor',
  category: 'wallet_bag',
  attributes: { brand: 'Nike', color: 'black' },
  ...overrides,
});

function setup({ found = stored(), updated = { ...stored(), privateInfo: 'x' } } = {}) {
  const declarationRepository = {
    findById: vi.fn().mockResolvedValue(found),
    findByIdWithPrivateInfo: vi.fn().mockResolvedValue(found && { ...found, privateInfo: 'x' }),
    updateFields: vi.fn().mockResolvedValue(updated),
  };
  const userRepository = { findById: vi.fn() };
  const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
  const service = createDeclarationService({ declarationRepository, userRepository, eventBus });

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

describe('declaration service, update', () => {
  describe('what does not exist', () => {
    it('answers not found for an unknown id', async () => {
      const { service, declarationRepository } = setup({ found: null });

      await expectNotFound(service.update(OWNER, ID, { title: 'Blue backpack' }));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it.each([
      ['the owner', OWNER],
      ['an admin', ADMIN],
      ['a stranger', STRANGER],
    ])('treats a deleted declaration as missing for %s', async (_who, user) => {
      const { service, declarationRepository } = setup({ found: stored({ status: 'deleted' }) });

      await expectNotFound(service.update(user, ID, { title: 'Blue backpack' }));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });
  });

  describe('a stranger', () => {
    it('is refused with 403 on a declaration they can read', async () => {
      const { service, declarationRepository, eventBus } = setup();

      await expectForbidden(service.update(STRANGER, ID, { title: 'Blue backpack' }));
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('gets 404, not 403, on a hidden declaration', async () => {
      const { service } = setup({ found: stored({ status: 'hidden' }) });

      await expectNotFound(service.update(STRANGER, ID, { title: 'Blue backpack' }));
    });
  });

  describe('the owner', () => {
    it.each(['pending', 'expired'])('may edit a %s declaration', async (status) => {
      const { service, declarationRepository } = setup({ found: stored({ status }) });

      await service.update(OWNER, ID, { title: 'Blue backpack' });

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { title: 'Blue backpack' },
        status,
      );
    });

    it.each(['matched', 'hidden', 'resolved'])(
      'is refused with 403 on a %s declaration',
      async (status) => {
        const { service, declarationRepository, eventBus } = setup({ found: stored({ status }) });

        await expect(service.update(OWNER, ID, { title: 'Blue backpack' })).rejects.toMatchObject({
          statusCode: 403,
          message: `A ${status} declaration cannot be edited`,
        });
        expect(declarationRepository.updateFields).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
      },
    );

    it('compares the owner as text, whatever the type of the ids', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ owner: { toString: () => OWNER_ID } }),
      });

      await service.update(OWNER, ID, { title: 'Blue backpack' });

      expect(declarationRepository.updateFields).toHaveBeenCalled();
    });
  });

  describe('an admin', () => {
    it.each(['pending', 'matched', 'hidden', 'resolved', 'expired'])(
      'may edit a %s declaration they do not own',
      async (status) => {
        const { service, declarationRepository } = setup({ found: stored({ status }) });

        await service.update(ADMIN, ID, { title: 'Blue backpack' });

        expect(declarationRepository.updateFields).toHaveBeenCalledWith(
          ID,
          { title: 'Blue backpack' },
          status,
        );
      },
    );

    it('announces the owner of the declaration, not the admin', async () => {
      const { service, eventBus } = setup();

      await service.update(ADMIN, ID, { title: 'Blue backpack' });

      expect(eventBus.emit).toHaveBeenCalledWith('declaration.updated', {
        declarationId: ID,
        ownerId: OWNER_ID,
        changedFields: ['title'],
      });
    });
  });

  describe('what is written', () => {
    it('writes only the fields that really change', async () => {
      const { service, declarationRepository } = setup();

      await service.update(OWNER, ID, {
        title: 'Black backpack',
        location: 'Cafeteria',
        category: 'wallet_bag',
      });

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { location: 'Cafeteria' },
        'pending',
      );
    });

    it('writes every editable field that changes', async () => {
      const { service, declarationRepository } = setup();
      const changes = {
        title: 'Blue backpack',
        description: 'Blue Nike backpack with a green keychain.',
        date: new Date('2026-10-13T00:00:00Z'),
        location: 'Cafeteria',
        category: 'keys',
        attributes: { color: 'blue' },
      };

      await service.update(OWNER, ID, changes);

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(ID, changes, 'pending');
    });

    it('ignores type, owner, status, picture and privateInfo, even if validation missed them', async () => {
      const { service, declarationRepository } = setup();

      await service.update(OWNER, ID, {
        title: 'Blue backpack',
        type: 'found',
        owner: 'someone-else',
        status: 'resolved',
        picture: 'uploads/evil.png',
        privateInfo: 'changed',
        deletedAt: new Date(),
        statusBeforeHidden: 'matched',
      });

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { title: 'Blue backpack' },
        'pending',
      );
    });

    it('sees the same date as unchanged, whatever the Date instance', async () => {
      const { service, declarationRepository } = setup();

      await service.update(OWNER, ID, { date: new Date('2026-10-12T00:00:00Z') });

      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it('sees the same attributes as unchanged, whatever the order of the keys', async () => {
      const { service, declarationRepository } = setup();

      await service.update(OWNER, ID, { attributes: { color: 'black', brand: 'Nike' } });

      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
    });

    it('compares the attributes of a Mongoose document, which is a Map', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ attributes: new Map([['brand', 'Nike']]) }),
      });

      await service.update(OWNER, ID, { attributes: { brand: 'Nike' } });
      expect(declarationRepository.updateFields).not.toHaveBeenCalled();

      await service.update(OWNER, ID, { attributes: { brand: 'Adidas' } });
      expect(declarationRepository.updateFields).toHaveBeenCalledTimes(1);
    });

    it('replaces the attributes as a whole, and an empty object clears them', async () => {
      const { service, declarationRepository } = setup();

      await service.update(OWNER, ID, { attributes: {} });

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { attributes: {} },
        'pending',
      );
    });

    it('treats attributes on a declaration that has none as a change', async () => {
      const { service, declarationRepository } = setup({
        found: stored({ attributes: undefined }),
      });

      await service.update(OWNER, ID, { attributes: { brand: 'Nike' } });

      expect(declarationRepository.updateFields).toHaveBeenCalled();
    });
  });

  describe('when nothing changes', () => {
    it('writes nothing, announces nothing, and still returns the full view', async () => {
      const { service, declarationRepository, eventBus } = setup();

      const result = await service.update(OWNER, ID, {
        title: 'Black backpack',
        location: 'Main library, 2nd floor',
      });

      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(declarationRepository.findByIdWithPrivateInfo).toHaveBeenCalledWith(ID);
      expect(result.privateInfo).toBe('x');
    });

    it('answers not found when the declaration vanished before the full read', async () => {
      const { service, declarationRepository } = setup();
      declarationRepository.findByIdWithPrivateInfo.mockResolvedValue(null);

      await expectNotFound(service.update(OWNER, ID, { title: 'Black backpack' }));
    });

    it('answers not found when it was deleted before the full read', async () => {
      const { service, declarationRepository } = setup();
      declarationRepository.findByIdWithPrivateInfo.mockResolvedValue(
        stored({ status: 'deleted' }),
      );

      await expectNotFound(service.update(OWNER, ID, { title: 'Black backpack' }));
    });
  });

  describe('the result and the event', () => {
    it('returns what the repository wrote', async () => {
      const updated = { ...stored({ title: 'Blue backpack' }), privateInfo: 'x' };
      const { service } = setup({ updated });

      const result = await service.update(OWNER, ID, { title: 'Blue backpack' });

      expect(result).toBe(updated);
    });

    it('announces declaration.updated with string ids and the changed fields, after the save', async () => {
      const { service, declarationRepository, eventBus } = setup();

      await service.update(OWNER, ID, {
        title: 'Blue backpack',
        location: 'Cafeteria',
        category: 'wallet_bag',
      });

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('declaration.updated', {
        declarationId: ID,
        ownerId: OWNER_ID,
        changedFields: ['title', 'location'],
      });
      expect(declarationRepository.updateFields.mock.invocationCallOrder[0]).toBeLessThan(
        eventBus.emit.mock.invocationCallOrder[0],
      );
    });

    it('does not announce the fields that were sent but did not change', async () => {
      const { service, eventBus } = setup();

      await service.update(OWNER, ID, { title: 'Black backpack', location: 'Cafeteria' });

      expect(eventBus.emit.mock.calls[0][1].changedFields).toEqual(['location']);
    });
  });

  describe('when the declaration moves while it is edited', () => {
    it('answers 409 and announces nothing when the write matched nothing', async () => {
      const { service, eventBus } = setup({ updated: null });

      await expect(service.update(OWNER, ID, { title: 'Blue backpack' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('rethrows a failed write and announces nothing', async () => {
      const failure = new Error('database down');
      const { service, declarationRepository, eventBus } = setup();
      declarationRepository.updateFields.mockRejectedValue(failure);

      await expect(service.update(OWNER, ID, { title: 'Blue backpack' })).rejects.toBe(failure);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
