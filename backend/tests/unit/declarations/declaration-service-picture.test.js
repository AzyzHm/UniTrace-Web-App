import { describe, expect, it, vi } from 'vitest';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';

const ID = '507f1f77bcf86cd799439055';
const OWNER_ID = '507f1f77bcf86cd799439022';
const OWNER = { _id: OWNER_ID, role: 'user' };
const STRANGER = { _id: '507f1f77bcf86cd799439033', role: 'user' };
const ADMIN = { _id: '507f1f77bcf86cd799439044', role: 'admin' };
const NOW = new Date('2026-10-26T10:00:00Z');
const OLD_FILE = `${'a'.repeat(32)}.png`;
const NEW_FILE = `${'b'.repeat(32)}.webp`;
const PICTURE = { buffer: Buffer.from('x'), mime: 'image/webp', ext: 'webp' };

const stored = (overrides = {}) => ({
  _id: ID,
  owner: OWNER_ID,
  status: 'pending',
  statusBeforeHidden: null,
  category: 'wallet_bag',
  picture: null,
  ...overrides,
});

function setup({ found = stored(), updated, createResult } = {}) {
  const declarationRepository = {
    findById: vi.fn().mockResolvedValue(found),
    findByIdWithPrivateInfo: vi.fn().mockResolvedValue(found),
    updateFields: vi.fn().mockResolvedValue(updated === undefined ? { _id: ID } : updated),
    create: vi.fn().mockImplementation(async (data) => createResult ?? { _id: ID, ...data }),
  };
  const userRepository = { findById: vi.fn() };
  const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
  const pictureStorage = {
    save: vi.fn().mockResolvedValue(NEW_FILE),
    remove: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn((name) => `/uploads/${name}`),
    contentTypeOf: vi.fn(() => 'image/png'),
  };
  const service = createDeclarationService({
    declarationRepository,
    userRepository,
    eventBus,
    pictureStorage,
    clock: () => NOW,
  });

  return { service, declarationRepository, eventBus, pictureStorage };
}

const expectNotFound = (promise, message = 'Declaration not found') =>
  expect(promise).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message });
const expectForbidden = (promise) =>
  expect(promise).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
const expectConflict = (promise) =>
  expect(promise).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

describe('declaration service, pictures', () => {
  describe('create with a picture', () => {
    const input = { title: 'Keys', type: 'lost', picture: 'uploads/evil.png' };

    it('saves the file and stores its name, ignoring any picture in the input', async () => {
      const { service, declarationRepository, pictureStorage } = setup();

      await service.create(OWNER, input, PICTURE);

      expect(pictureStorage.save).toHaveBeenCalledWith(PICTURE);
      expect(declarationRepository.create.mock.calls[0][0].picture).toBe(NEW_FILE);
    });

    it('writes no file and no picture without one', async () => {
      const { service, declarationRepository, pictureStorage } = setup();

      await service.create(OWNER, input);

      expect(pictureStorage.save).not.toHaveBeenCalled();
      expect(declarationRepository.create.mock.calls[0][0]).not.toHaveProperty('picture');
    });

    it('removes the file again when the database refuses the declaration', async () => {
      const { service, declarationRepository, pictureStorage } = setup();
      declarationRepository.create.mockRejectedValue(new Error('db down'));

      await expect(service.create(OWNER, input, PICTURE)).rejects.toThrow('db down');

      expect(pictureStorage.remove).toHaveBeenCalledWith(NEW_FILE);
    });

    it('fails loudly when it has no storage and a picture comes', async () => {
      const service = createDeclarationService({
        declarationRepository: { create: vi.fn() },
        userRepository: {},
        eventBus: {},
      });

      await expect(service.create(OWNER, input, PICTURE)).rejects.toThrow(/pictureStorage/);
    });
  });

  describe('setPicture', () => {
    it('stores the new name with the status the decision was based on', async () => {
      const { service, declarationRepository } = setup();

      await service.setPicture(OWNER, ID, PICTURE);

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { picture: NEW_FILE },
        'pending',
      );
    });

    it('removes the old file after the write, and keeps the new one', async () => {
      const { service, pictureStorage } = setup({ found: stored({ picture: OLD_FILE }) });

      await service.setPicture(OWNER, ID, PICTURE);

      expect(pictureStorage.remove).toHaveBeenCalledTimes(1);
      expect(pictureStorage.remove).toHaveBeenCalledWith(OLD_FILE);
    });

    it('announces the change', async () => {
      const { service, eventBus } = setup();

      await service.setPicture(OWNER, ID, PICTURE);

      expect(eventBus.emit).toHaveBeenCalledWith('declaration.updated', {
        declarationId: ID,
        ownerId: OWNER_ID,
        changedFields: ['picture'],
      });
    });

    it('lets an admin do it on a declaration that is not pending', async () => {
      const { service } = setup({ found: stored({ status: 'resolved' }) });

      await expect(service.setPicture(ADMIN, ID, PICTURE)).resolves.toBeDefined();
    });

    it('removes the new file and answers 409 when the status moved meanwhile', async () => {
      const { service, pictureStorage, eventBus } = setup({
        found: stored({ picture: OLD_FILE }),
        updated: null,
      });

      await expectConflict(service.setPicture(OWNER, ID, PICTURE));

      expect(pictureStorage.remove).toHaveBeenCalledTimes(1);
      expect(pictureStorage.remove).toHaveBeenCalledWith(NEW_FILE);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('removes the new file when the write throws', async () => {
      const { service, declarationRepository, pictureStorage } = setup();
      declarationRepository.updateFields.mockRejectedValue(new Error('db down'));

      await expect(service.setPicture(OWNER, ID, PICTURE)).rejects.toThrow('db down');

      expect(pictureStorage.remove).toHaveBeenCalledWith(NEW_FILE);
    });

    describe('who may', () => {
      it('answers 404 for a deleted declaration, before any file is written', async () => {
        const { service, pictureStorage } = setup({ found: stored({ status: 'deleted' }) });

        await expectNotFound(service.setPicture(OWNER, ID, PICTURE));
        expect(pictureStorage.save).not.toHaveBeenCalled();
      });

      it('answers 404 for an unknown id', async () => {
        const { service } = setup({ found: null });

        await expectNotFound(service.setPicture(OWNER, ID, PICTURE));
      });

      it('answers 404 to a stranger for a hidden declaration', async () => {
        const { service } = setup({ found: stored({ status: 'hidden' }) });

        await expectNotFound(service.setPicture(STRANGER, ID, PICTURE));
      });

      it('answers 403 to a stranger otherwise', async () => {
        const { service, pictureStorage } = setup();

        await expectForbidden(service.setPicture(STRANGER, ID, PICTURE));
        expect(pictureStorage.save).not.toHaveBeenCalled();
      });

      it.each(['matched', 'resolved', 'hidden'])(
        'answers 403 to the owner of a %s declaration',
        async (status) => {
          const { service, pictureStorage } = setup({ found: stored({ status }) });

          await expectForbidden(service.setPicture(OWNER, ID, PICTURE));
          expect(pictureStorage.save).not.toHaveBeenCalled();
        },
      );

      it('lets the owner of an expired declaration do it', async () => {
        const { service } = setup({ found: stored({ status: 'expired' }) });

        await expect(service.setPicture(OWNER, ID, PICTURE)).resolves.toBeDefined();
      });
    });
  });

  describe('removePicture', () => {
    it('clears the picture and deletes the file', async () => {
      const { service, declarationRepository, pictureStorage, eventBus } = setup({
        found: stored({ picture: OLD_FILE }),
      });

      await service.removePicture(OWNER, ID);

      expect(declarationRepository.updateFields).toHaveBeenCalledWith(
        ID,
        { picture: null },
        'pending',
      );
      expect(pictureStorage.remove).toHaveBeenCalledWith(OLD_FILE);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'declaration.updated',
        expect.objectContaining({ changedFields: ['picture'] }),
      );
    });

    it('changes nothing and announces nothing when there is no picture', async () => {
      const { service, declarationRepository, pictureStorage, eventBus } = setup();

      await service.removePicture(OWNER, ID);

      expect(declarationRepository.updateFields).not.toHaveBeenCalled();
      expect(pictureStorage.remove).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('keeps the file and answers 409 when the status moved meanwhile', async () => {
      const { service, pictureStorage } = setup({
        found: stored({ picture: OLD_FILE }),
        updated: null,
      });

      await expectConflict(service.removePicture(OWNER, ID));
      expect(pictureStorage.remove).not.toHaveBeenCalled();
    });

    it('follows the edit rules', async () => {
      await expectForbidden(
        setup({ found: stored({ picture: OLD_FILE }) }).service.removePicture(STRANGER, ID),
      );
      await expectForbidden(
        setup({ found: stored({ picture: OLD_FILE, status: 'matched' }) }).service.removePicture(
          OWNER,
          ID,
        ),
      );
      await expectNotFound(
        setup({ found: stored({ status: 'deleted' }) }).service.removePicture(OWNER, ID),
      );
    });
  });

  describe('getPicture', () => {
    const withPicture = (overrides = {}) => stored({ picture: OLD_FILE, ...overrides });

    it('gives the owner the path and the type', async () => {
      const { service } = setup({ found: withPicture() });

      await expect(service.getPicture(OWNER, ID)).resolves.toEqual({
        filePath: `/uploads/${OLD_FILE}`,
        contentType: 'image/png',
      });
    });

    it('gives a stranger the picture of an ordinary category', async () => {
      const { service } = setup({ found: withPicture({ status: 'matched' }) });

      await expect(service.getPicture(STRANGER, ID)).resolves.toMatchObject({
        contentType: 'image/png',
      });
    });

    it('refuses a stranger the picture of a student card, as a 404', async () => {
      const { service } = setup({ found: withPicture({ category: 'student_card_id' }) });

      await expectNotFound(service.getPicture(STRANGER, ID), 'Picture not found');
    });

    it('keeps a student card picture for its owner and for an admin', async () => {
      const found = withPicture({ category: 'student_card_id' });

      await expect(setup({ found }).service.getPicture(OWNER, ID)).resolves.toBeDefined();
      await expect(setup({ found }).service.getPicture(ADMIN, ID)).resolves.toBeDefined();
    });

    it('refuses a stranger the picture of a hidden declaration, as a 404', async () => {
      const { service } = setup({ found: withPicture({ status: 'hidden' }) });

      await expectNotFound(service.getPicture(STRANGER, ID), 'Picture not found');
    });

    it('lets the owner and admins read a hidden one', async () => {
      const found = withPicture({ status: 'hidden' });

      await expect(setup({ found }).service.getPicture(OWNER, ID)).resolves.toBeDefined();
      await expect(setup({ found }).service.getPicture(ADMIN, ID)).resolves.toBeDefined();
    });

    it.each([
      ['an unknown id', null],
      ['a deleted declaration', withPicture({ status: 'deleted' })],
      ['a declaration with no picture', stored()],
    ])('answers the same 404 for %s', async (_name, found) => {
      const { service } = setup({ found });

      await expectNotFound(service.getPicture(OWNER, ID), 'Picture not found');
    });

    it('answers 404 for a stored name the storage would never have made', async () => {
      const { service, pictureStorage } = setup({ found: withPicture({ picture: '../x' }) });
      pictureStorage.resolve.mockReturnValue(null);

      await expectNotFound(service.getPicture(OWNER, ID), 'Picture not found');
    });
  });

  describe('deleting a declaration', () => {
    it('clears the picture and removes the file after the write', async () => {
      const { service, declarationRepository, pictureStorage } = setup({
        found: stored({ picture: OLD_FILE }),
      });

      await service.remove(OWNER, ID);

      expect(declarationRepository.updateFields.mock.calls[0][1]).toMatchObject({
        status: 'deleted',
        picture: null,
      });
      expect(pictureStorage.remove).toHaveBeenCalledWith(OLD_FILE);
    });

    it('keeps the file when the write was refused (status moved)', async () => {
      const { service, pictureStorage } = setup({
        found: stored({ picture: OLD_FILE }),
        updated: null,
      });

      await expectConflict(service.remove(OWNER, ID));
      expect(pictureStorage.remove).not.toHaveBeenCalled();
    });

    it('does not touch the picture for a move that is not a delete', async () => {
      const { service, declarationRepository, pictureStorage } = setup({
        found: stored({ picture: OLD_FILE }),
      });

      await service.changeStatus(OWNER, ID, 'resolved');

      expect(declarationRepository.updateFields.mock.calls[0][1]).not.toHaveProperty('picture');
      expect(pictureStorage.remove).not.toHaveBeenCalled();
    });

    it('still works for a service without storage when there is no picture', async () => {
      const declarationRepository = {
        findById: vi.fn().mockResolvedValue(stored()),
        updateFields: vi.fn().mockResolvedValue({ _id: ID }),
      };
      const service = createDeclarationService({
        declarationRepository,
        userRepository: {},
        eventBus: { emit: vi.fn() },
      });

      await expect(service.remove(OWNER, ID)).resolves.toBeDefined();
    });
  });
});
