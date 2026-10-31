import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { createDeclarationRepository } from '../../../src/repositories/declarations/declaration.repository.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const DELETED_AT = new Date('2026-10-20T10:00:00Z');
const OPEN = ['pending', 'expired'];

describe('declaration repository', () => {
  const repository = createDeclarationRepository();
  const sara = new mongoose.Types.ObjectId();
  const omar = new mongoose.Types.ObjectId();

  const create = (overrides = {}) =>
    repository.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library, 2nd floor',
      owner: sara,
      category: 'wallet_bag',
      ...overrides,
    });

  beforeAll(async () => {
    await connectTestDb();
    await Declaration.init();
  });

  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  describe('create and read', () => {
    it('stores the defaults', async () => {
      const declaration = await create();

      expect(declaration.status).toBe('pending');
      expect(declaration.statusBeforeHidden).toBeNull();
      expect(declaration.deletedAt).toBeNull();
      expect(declaration.createdAt).toBeInstanceOf(Date);
    });

    it('stores and returns the attributes as a plain object', async () => {
      const declaration = await create({ attributes: { brand: 'Nike', color: 'black' } });

      const found = await repository.findById(declaration._id);

      expect(JSON.parse(JSON.stringify(found)).attributes).toEqual({
        brand: 'Nike',
        color: 'black',
      });
    });

    it('stores statusBeforeHidden next to a hidden status', async () => {
      const declaration = await create({ status: 'hidden', statusBeforeHidden: 'matched' });

      expect((await repository.findById(declaration._id)).statusBeforeHidden).toBe('matched');
    });

    it('keeps the private info out of a normal read', async () => {
      const declaration = await create({ privateInfo: 'name on page 1' });

      const found = await repository.findById(declaration._id);

      expect(found.privateInfo).toBeUndefined();
      expect(JSON.stringify(found)).not.toContain('name on page 1');
    });

    it('returns the private info only through the explicit read', async () => {
      const declaration = await create({ privateInfo: 'name on page 1' });

      const found = await repository.findByIdWithPrivateInfo(declaration._id);

      expect(found.privateInfo).toBe('name on page 1');
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById(new mongoose.Types.ObjectId())).toBeNull();
    });

    it('rejects a document that breaks the schema, before touching the database', async () => {
      await expect(create({ type: 'stolen' })).rejects.toMatchObject({ name: 'ValidationError' });
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('builds the declared indexes', async () => {
      const indexes = await Declaration.collection.indexes();
      const keys = indexes.map((index) => index.key);

      expect(keys).toContainEqual({ type: 1, category: 1, status: 1, date: -1 });
      expect(keys).toContainEqual({ owner: 1, createdAt: -1 });
    });
  });

  describe('softDeleteByOwner', () => {
    it('deletes the owner declarations in the given statuses and reports each one', async () => {
      const pending = await create();
      const expired = await create({ status: 'expired' });

      const result = await repository.softDeleteByOwner(sara, OPEN, DELETED_AT);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ id: String(pending._id), from: 'pending' });
      expect(result).toContainEqual({ id: String(expired._id), from: 'expired' });
      for (const id of [pending._id, expired._id]) {
        const stored = await Declaration.findById(id);
        expect(stored.status).toBe('deleted');
        expect(stored.deletedAt).toEqual(DELETED_AT);
      }
    });

    it('leaves matched, resolved and hidden declarations as they are', async () => {
      const kept = await Promise.all(
        ['matched', 'resolved', 'hidden'].map((status) => create({ status })),
      );

      const result = await repository.softDeleteByOwner(sara, OPEN, DELETED_AT);

      expect(result).toEqual([]);
      for (const declaration of kept) {
        const stored = await Declaration.findById(declaration._id);
        expect(stored.status).toBe(declaration.status);
        expect(stored.deletedAt).toBeNull();
      }
    });

    it('leaves the declarations of other owners alone', async () => {
      const others = await create({ owner: omar });

      await repository.softDeleteByOwner(sara, OPEN, DELETED_AT);

      expect((await Declaration.findById(others._id)).status).toBe('pending');
    });

    it('returns an empty list for an owner with nothing to delete', async () => {
      expect(await repository.softDeleteByOwner(sara, OPEN, DELETED_AT)).toEqual([]);
    });

    it('does not report a declaration that is already deleted', async () => {
      await create({ status: 'deleted' });

      expect(await repository.softDeleteByOwner(sara, OPEN, DELETED_AT)).toEqual([]);
    });
  });

  describe('clearPrivateInfoByOwner', () => {
    it('erases the private info of every status of the owner and counts them', async () => {
      const a = await create({ privateInfo: 'one' });
      const b = await create({ status: 'resolved', privateInfo: 'two' });
      await create();

      const count = await repository.clearPrivateInfoByOwner(sara);

      expect(count).toBe(2);
      for (const id of [a._id, b._id]) {
        expect((await repository.findByIdWithPrivateInfo(id)).privateInfo).toBeNull();
      }
    });

    it('leaves the other fields and the other owners alone', async () => {
      const mine = await create({ privateInfo: 'one' });
      const theirs = await create({ owner: omar, privateInfo: 'secret' });

      await repository.clearPrivateInfoByOwner(sara);

      expect((await repository.findById(mine._id)).title).toBe('Black backpack');
      expect((await repository.findByIdWithPrivateInfo(theirs._id)).privateInfo).toBe('secret');
    });

    it('counts nothing when no declaration holds a private info', async () => {
      await create();

      expect(await repository.clearPrivateInfoByOwner(sara)).toBe(0);
    });
  });

  describe('clearPicturesByOwner', () => {
    const A = `${'a'.repeat(32)}.png`;
    const B = `${'b'.repeat(32)}.jpg`;

    it('detaches the picture of every status of the owner and returns the file names', async () => {
      const a = await create({ picture: A });
      const b = await create({ status: 'resolved', picture: B });
      await create();

      const names = await repository.clearPicturesByOwner(sara);

      expect(names.sort()).toEqual([A, B]);
      for (const id of [a._id, b._id]) {
        expect((await repository.findById(id)).picture).toBeNull();
      }
    });

    it('leaves the other fields and the other owners alone', async () => {
      const mine = await create({ picture: A });
      const theirs = await create({ owner: omar, picture: B });

      await repository.clearPicturesByOwner(sara);

      expect((await repository.findById(mine._id)).title).toBe('Black backpack');
      expect((await repository.findById(theirs._id)).picture).toBe(B);
    });

    it('returns an empty list when no declaration has a picture', async () => {
      await create();

      expect(await repository.clearPicturesByOwner(sara)).toEqual([]);
    });
  });

  describe('findPageByOwner', () => {
    const PAGE = { skip: 0, limit: 20 };

    it('returns only the declarations of that owner', async () => {
      const mine = await create();
      await create({ owner: omar });

      const { items, total } = await repository.findPageByOwner(sara, PAGE);

      expect(items.map((item) => String(item._id))).toEqual([String(mine._id)]);
      expect(total).toBe(1);
    });

    it('lists newest first', async () => {
      const oldest = await create({ title: 'Oldest one', createdAt: new Date('2026-10-01') });
      const newest = await create({ title: 'Newest one', createdAt: new Date('2026-10-03') });
      const middle = await create({ title: 'Middle one', createdAt: new Date('2026-10-02') });

      const { items } = await repository.findPageByOwner(sara, PAGE);

      expect(items.map((item) => String(item._id))).toEqual(
        [newest, middle, oldest].map((item) => String(item._id)),
      );
    });

    it('never lists a deleted declaration, and does not count it', async () => {
      await create();
      await create({ status: 'deleted', deletedAt: DELETED_AT });

      const { items, total } = await repository.findPageByOwner(sara, PAGE);

      expect(items).toHaveLength(1);
      expect(total).toBe(1);
    });

    it('lists hidden, resolved and matched ones, the owner knows about them', async () => {
      for (const status of ['hidden', 'resolved', 'matched']) await create({ status });

      const { total } = await repository.findPageByOwner(sara, PAGE);

      expect(total).toBe(3);
    });

    it('filters on the status', async () => {
      await create();
      const matched = await create({ status: 'matched' });

      const { items, total } = await repository.findPageByOwner(sara, {
        ...PAGE,
        status: 'matched',
      });

      expect(items.map((item) => String(item._id))).toEqual([String(matched._id)]);
      expect(total).toBe(1);
    });

    it('filters on the type, and on type and status together', async () => {
      await create({ type: 'lost' });
      await create({ type: 'found' });
      const foundMatched = await create({ type: 'found', status: 'matched' });

      const byType = await repository.findPageByOwner(sara, { ...PAGE, type: 'found' });
      const both = await repository.findPageByOwner(sara, {
        ...PAGE,
        type: 'found',
        status: 'matched',
      });

      expect(byType.total).toBe(2);
      expect(both.items.map((item) => String(item._id))).toEqual([String(foundMatched._id)]);
    });

    it('cuts pages with skip and limit and keeps the total of all pages', async () => {
      for (let day = 1; day <= 5; day += 1) {
        await create({ title: `Item number ${day}`, createdAt: new Date(`2026-10-0${day}`) });
      }

      const first = await repository.findPageByOwner(sara, { skip: 0, limit: 2 });
      const last = await repository.findPageByOwner(sara, { skip: 4, limit: 2 });

      expect(first.items.map((item) => item.title)).toEqual(['Item number 5', 'Item number 4']);
      expect(last.items.map((item) => item.title)).toEqual(['Item number 1']);
      expect(first.total).toBe(5);
      expect(last.total).toBe(5);
    });

    it('keeps a stable order when declarations share the same creation time', async () => {
      const sameTime = new Date('2026-10-05T10:00:00Z');
      for (let n = 1; n <= 4; n += 1)
        await create({ title: `Same time ${n}`, createdAt: sameTime });

      const first = await repository.findPageByOwner(sara, { skip: 0, limit: 2 });
      const second = await repository.findPageByOwner(sara, { skip: 2, limit: 2 });

      const seen = [...first.items, ...second.items].map((item) => String(item._id));
      expect(new Set(seen).size).toBe(4);
    });

    it('returns an empty page past the end', async () => {
      await create();

      const { items, total } = await repository.findPageByOwner(sara, { skip: 20, limit: 20 });

      expect(items).toEqual([]);
      expect(total).toBe(1);
    });

    it('does not load the private info', async () => {
      await create({ privateInfo: 'name on page 1' });

      const { items } = await repository.findPageByOwner(sara, PAGE);

      expect(items[0].privateInfo).toBeUndefined();
      expect(JSON.stringify(items)).not.toContain('name on page 1');
    });
  });
});
