import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../src/exceptions/app-error.js';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';

const USER = { _id: '507f1f77bcf86cd799439011', role: 'user' };
const SAVED_ID = '507f1f77bcf86cd799439099';

const INPUT = {
  title: 'Black backpack',
  type: 'lost',
  description: 'Black Nike backpack with a red keychain.',
  date: new Date('2026-10-12T00:00:00Z'),
  location: 'Main library, 2nd floor',
  category: 'wallet_bag',
  attributes: { brand: 'Nike' },
  privateInfo: 'Name on page 1',
};

function setup({ create } = {}) {
  const declarationRepository = {
    create: create ?? vi.fn(async (data) => ({ _id: SAVED_ID, ...data })),
  };
  const userRepository = { findById: vi.fn() };
  const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
  const service = createDeclarationService({ declarationRepository, userRepository, eventBus });

  return { service, declarationRepository, userRepository, eventBus };
}

describe('declaration service, create', () => {
  it('requires its dependencies', () => {
    expect(() => createDeclarationService({})).toThrow(/required/);
    expect(() => createDeclarationService({ declarationRepository: {}, eventBus: {} })).toThrow(
      /userRepository/,
    );
  });

  it('saves the user data with the owner from the user and the status pending', async () => {
    const { service, declarationRepository } = setup();

    await service.create(USER, INPUT);

    expect(declarationRepository.create).toHaveBeenCalledWith({
      ...INPUT,
      owner: USER._id,
      status: 'pending',
    });
  });

  it('returns what the repository saved', async () => {
    const { service } = setup();

    const declaration = await service.create(USER, INPUT);

    expect(declaration._id).toBe(SAVED_ID);
    expect(declaration.title).toBe('Black backpack');
  });

  it('does not send optional fields the user left out', async () => {
    const { service, declarationRepository } = setup();
    const { attributes, privateInfo, ...required } = INPUT;

    await service.create(USER, required);

    const saved = declarationRepository.create.mock.calls[0][0];
    expect(saved).not.toHaveProperty('attributes');
    expect(saved).not.toHaveProperty('privateInfo');
    expect(attributes).toBeDefined();
    expect(privateInfo).toBeDefined();
  });

  it('ignores owner, status and every other field that is not creatable, even if validation missed it', async () => {
    const { service, declarationRepository } = setup();

    await service.create(USER, {
      ...INPUT,
      owner: 'someone-else',
      status: 'resolved',
      deletedAt: new Date(),
      statusBeforeHidden: 'matched',
      picture: 'uploads/evil.png',
    });

    expect(declarationRepository.create).toHaveBeenCalledWith({
      ...INPUT,
      owner: USER._id,
      status: 'pending',
    });
  });

  it('announces declaration.created with string ids, after the save', async () => {
    const { service, declarationRepository, eventBus } = setup();

    await service.create(USER, INPUT);

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('declaration.created', {
      declarationId: SAVED_ID,
      ownerId: USER._id,
      type: 'lost',
      category: 'wallet_bag',
    });
    expect(declarationRepository.create.mock.invocationCallOrder[0]).toBeLessThan(
      eventBus.emit.mock.invocationCallOrder[0],
    );
  });

  it('announces nothing and rethrows when the save fails', async () => {
    const failure = new Error('database down');
    const { service, eventBus } = setup({ create: vi.fn().mockRejectedValue(failure) });

    await expect(service.create(USER, INPUT)).rejects.toBe(failure);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

describe('declaration service, listMine', () => {
  function setupList(result = { items: [], total: 0 }) {
    const declarationRepository = { findPageByOwner: vi.fn().mockResolvedValue(result) };
    const userRepository = { findById: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const service = createDeclarationService({ declarationRepository, userRepository, eventBus });
    return { service, declarationRepository, eventBus };
  }

  it('asks for the page of the connected user, never of someone else', async () => {
    const { service, declarationRepository } = setupList();

    await service.listMine(USER, { page: 1, limit: 20 });

    expect(declarationRepository.findPageByOwner).toHaveBeenCalledWith(USER._id, {
      type: undefined,
      status: undefined,
      skip: 0,
      limit: 20,
    });
  });

  it('turns the page number into a skip', async () => {
    const { service, declarationRepository } = setupList();

    await service.listMine(USER, { page: 3, limit: 10 });

    expect(declarationRepository.findPageByOwner.mock.calls[0][1]).toMatchObject({
      skip: 20,
      limit: 10,
    });
  });

  it('passes the filters on', async () => {
    const { service, declarationRepository } = setupList();

    await service.listMine(USER, { page: 1, limit: 20, type: 'found', status: 'hidden' });

    expect(declarationRepository.findPageByOwner.mock.calls[0][1]).toMatchObject({
      type: 'found',
      status: 'hidden',
    });
  });

  it('returns the rows with the page, the limit, the total and the page count', async () => {
    const items = [{ _id: 'a' }, { _id: 'b' }];
    const { service } = setupList({ items, total: 41 });

    const result = await service.listMine(USER, { page: 2, limit: 20 });

    expect(result).toEqual({ items, page: 2, limit: 20, total: 41, totalPages: 3 });
  });

  it('counts zero pages when nothing matches', async () => {
    const { service } = setupList({ items: [], total: 0 });

    const result = await service.listMine(USER, { page: 1, limit: 20 });

    expect(result.totalPages).toBe(0);
  });

  it('announces nothing, a read changes nothing', async () => {
    const { service, eventBus } = setupList();

    await service.listMine(USER, { page: 1, limit: 20 });

    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

describe('declaration service, getById', () => {
  const ID = '507f1f77bcf86cd799439055';
  const OWNER_ID = '507f1f77bcf86cd799439022';
  const OWNER = { _id: OWNER_ID, role: 'user' };
  const STRANGER = { _id: '507f1f77bcf86cd799439033', role: 'user' };
  const ADMIN = { _id: '507f1f77bcf86cd799439044', role: 'admin' };

  const row = (overrides = {}) => ({ _id: ID, owner: OWNER_ID, status: 'pending', ...overrides });

  function setupGet(stored = row(), { ownerAccount = { _id: OWNER_ID, deletedAt: null } } = {}) {
    const declarationRepository = {
      findById: vi.fn().mockResolvedValue(stored),
      findByIdWithPrivateInfo: vi.fn().mockResolvedValue(stored && { ...stored, privateInfo: 'x' }),
    };
    const userRepository = { findById: vi.fn().mockResolvedValue(ownerAccount) };
    const eventBus = { emit: vi.fn() };
    const service = createDeclarationService({ declarationRepository, userRepository, eventBus });

    return { service, declarationRepository, userRepository, eventBus };
  }

  const expectNotFound = (promise) =>
    expect(promise).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Declaration not found',
    });

  describe('what does not exist', () => {
    it('throws a NotFoundError for an unknown id', async () => {
      const { service } = setupGet(null);

      await expect(service.getById(OWNER, ID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each([
      ['the owner', OWNER],
      ['an admin', ADMIN],
      ['a stranger', STRANGER],
    ])('treats a deleted declaration as missing for %s', async (_who, user) => {
      const { service, declarationRepository } = setupGet(row({ status: 'deleted' }));

      await expectNotFound(service.getById(user, ID));
      expect(declarationRepository.findByIdWithPrivateInfo).not.toHaveBeenCalled();
    });

    it('treats a declaration deleted between the two reads as missing', async () => {
      const { service, declarationRepository } = setupGet(row());
      declarationRepository.findByIdWithPrivateInfo.mockResolvedValue(row({ status: 'deleted' }));

      await expectNotFound(service.getById(OWNER, ID));
    });

    it('treats a declaration that vanished between the two reads as missing', async () => {
      const { service, declarationRepository } = setupGet(row());
      declarationRepository.findByIdWithPrivateInfo.mockResolvedValue(null);

      await expectNotFound(service.getById(OWNER, ID));
    });
  });

  describe('hidden declarations', () => {
    it('answers 404, not 403, to a stranger', async () => {
      const { service } = setupGet(row({ status: 'hidden' }));

      await expectNotFound(service.getById(STRANGER, ID));
    });

    it('does not even look at the owner account for a stranger', async () => {
      const { service, userRepository } = setupGet(row({ status: 'hidden' }));

      await expectNotFound(service.getById(STRANGER, ID));
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('still shows it to its owner', async () => {
      const { service } = setupGet(row({ status: 'hidden' }));

      const result = await service.getById(OWNER, ID);

      expect(result.declaration.status).toBe('hidden');
      expect(result.canSeePrivate).toBe(true);
    });

    it('still shows it to an admin', async () => {
      const { service } = setupGet(row({ status: 'hidden' }));

      const result = await service.getById(ADMIN, ID);

      expect(result.declaration.status).toBe('hidden');
      expect(result.canSeePrivate).toBe(true);
    });
  });

  describe('a stranger', () => {
    it.each(['pending', 'matched', 'resolved', 'expired'])(
      'reads a %s declaration, public part only',
      async (status) => {
        const { service } = setupGet(row({ status }));

        const result = await service.getById(STRANGER, ID);

        expect(result).toMatchObject({ isOwner: false, canSeePrivate: false });
        expect(result.declaration.status).toBe(status);
      },
    );

    it('never loads the private info', async () => {
      const { service, declarationRepository } = setupGet();

      const result = await service.getById(STRANGER, ID);

      expect(declarationRepository.findById).toHaveBeenCalledWith(ID);
      expect(declarationRepository.findByIdWithPrivateInfo).not.toHaveBeenCalled();
      expect(result.declaration).not.toHaveProperty('privateInfo');
    });

    it('is not told the owner is deleted while the account is alive', async () => {
      const { service, userRepository } = setupGet();

      const result = await service.getById(STRANGER, ID);

      expect(userRepository.findById).toHaveBeenCalledWith(OWNER_ID);
      expect(result.ownerDeleted).toBe(false);
    });

    it('is told the owner is deleted once the account is anonymized', async () => {
      const { service } = setupGet(row({ status: 'resolved' }), {
        ownerAccount: { _id: OWNER_ID, deletedAt: new Date() },
      });

      const result = await service.getById(STRANGER, ID);

      expect(result.ownerDeleted).toBe(true);
    });

    it('counts an owner account that cannot be found as deleted', async () => {
      const { service } = setupGet(row(), { ownerAccount: null });

      const result = await service.getById(STRANGER, ID);

      expect(result.ownerDeleted).toBe(true);
    });
  });

  describe('the owner', () => {
    it('gets the private info through the second read', async () => {
      const { service, declarationRepository } = setupGet();

      const result = await service.getById(OWNER, ID);

      expect(declarationRepository.findByIdWithPrivateInfo).toHaveBeenCalledWith(ID);
      expect(result).toMatchObject({ isOwner: true, canSeePrivate: true });
      expect(result.declaration.privateInfo).toBe('x');
    });

    it('compares the owner as text, whatever the type of the ids', async () => {
      const { service } = setupGet(row({ owner: { toString: () => OWNER_ID } }));

      const result = await service.getById(OWNER, ID);

      expect(result.isOwner).toBe(true);
    });

    it('is never an owner whose account is deleted, so no user lookup is made', async () => {
      const { service, userRepository } = setupGet();

      const result = await service.getById(OWNER, ID);

      expect(result.ownerDeleted).toBe(false);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('an admin', () => {
    it('gets the private info without being the owner', async () => {
      const { service, declarationRepository } = setupGet();

      const result = await service.getById(ADMIN, ID);

      expect(declarationRepository.findByIdWithPrivateInfo).toHaveBeenCalledWith(ID);
      expect(result).toMatchObject({ isOwner: false, canSeePrivate: true });
    });

    it('is told when the owner is deleted', async () => {
      const { service } = setupGet(row({ status: 'matched' }), {
        ownerAccount: { _id: OWNER_ID, deletedAt: new Date() },
      });

      const result = await service.getById(ADMIN, ID);

      expect(result.ownerDeleted).toBe(true);
    });
  });

  describe('allowedTransitions', () => {
    const allowed = async (user, overrides) => {
      const { service } = setupGet(row(overrides));
      return (await service.getById(user, ID)).allowedTransitions;
    };

    it.each(['pending', 'matched', 'resolved', 'expired'])(
      'is empty for a stranger on a %s declaration',
      async (status) => {
        expect(await allowed(STRANGER, { status })).toEqual([]);
      },
    );

    it.each([
      ['pending', ['resolved', 'deleted']],
      ['matched', ['resolved', 'deleted']],
      ['resolved', []],
      ['expired', ['pending', 'deleted']],
      ['hidden', []],
    ])('gives the owner of a %s declaration %j', async (status, expected) => {
      expect(await allowed(OWNER, { status })).toEqual(expected);
    });

    it.each([
      ['pending', ['resolved', 'hidden', 'deleted']],
      ['matched', ['resolved', 'hidden', 'deleted']],
      ['resolved', ['pending', 'hidden', 'deleted']],
      ['expired', ['pending', 'deleted']],
    ])('gives an admin on a %s declaration %j', async (status, expected) => {
      expect(await allowed(ADMIN, { status })).toEqual(expected);
    });

    it('never lists a move reserved to the system', async () => {
      const list = await allowed(ADMIN, { status: 'pending' });

      expect(list).not.toContain('matched');
      expect(list).not.toContain('expired');
    });

    it('lets an admin restore a hidden declaration only where it came from, or delete it', async () => {
      expect(await allowed(ADMIN, { status: 'hidden', statusBeforeHidden: 'matched' })).toEqual([
        'matched',
        'deleted',
      ]);
    });

    it('lets an admin restore to any status when the old one was not kept', async () => {
      expect(await allowed(ADMIN, { status: 'hidden', statusBeforeHidden: null })).toEqual([
        'pending',
        'matched',
        'resolved',
        'deleted',
      ]);
    });

    it('treats an admin who owns the declaration as an admin', async () => {
      const { service } = setupGet(row({ owner: ADMIN._id, status: 'resolved' }));

      const result = await service.getById(ADMIN, ID);

      expect(result.allowedTransitions).toEqual(['pending', 'hidden', 'deleted']);
    });
  });

  it('announces nothing, a read changes nothing', async () => {
    const { service, eventBus } = setupGet();

    await service.getById(OWNER, ID);
    await service.getById(STRANGER, ID);

    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
