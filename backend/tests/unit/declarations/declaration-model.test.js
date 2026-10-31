import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS } from '../../../src/constants/declarations/categories.js';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';

function build(overrides = {}) {
  return new Declaration({
    title: 'Black backpack',
    type: 'lost',
    description: 'Black Nike backpack with a red keychain.',
    date: new Date('2026-10-12T00:00:00Z'),
    location: 'Main library, 2nd floor',
    owner: new mongoose.Types.ObjectId(),
    category: 'wallet_bag',
    ...overrides,
  });
}

const errorsOf = (doc) =>
  doc.validate().then(
    () => [],
    (err) => Object.keys(err.errors),
  );

describe('Declaration model, rules', () => {
  it('accepts a complete declaration', async () => {
    await expect(build().validate()).resolves.toBeUndefined();
  });

  it('applies safe defaults', () => {
    const doc = build();

    expect(doc.status).toBe('pending');
    expect(doc.statusBeforeHidden).toBeNull();
    expect(doc.picture).toBeNull();
    expect(doc.privateInfo).toBeNull();
    expect(doc.deletedAt).toBeNull();
    expect(doc.attributes.size).toBe(0);
  });

  it('requires every mandatory field', async () => {
    const errors = await errorsOf(new Declaration({}));

    expect(errors.sort()).toEqual(
      ['category', 'date', 'description', 'location', 'owner', 'title', 'type'].sort(),
    );
  });

  it('trims the text fields', () => {
    const doc = build({ title: '  Black backpack ', location: ' Library ' });

    expect(doc.title).toBe('Black backpack');
    expect(doc.location).toBe('Library');
  });

  it.each([
    ['title too short', { title: 'ab' }, 'title'],
    ['title too long', { title: 'a'.repeat(101) }, 'title'],
    ['description too short', { description: 'too short' }, 'description'],
    ['description too long', { description: 'a'.repeat(1001) }, 'description'],
    ['location too short', { location: 'a' }, 'location'],
    ['location too long', { location: 'a'.repeat(151) }, 'location'],
    ['privateInfo too long', { privateInfo: 'a'.repeat(501) }, 'privateInfo'],
    ['unknown type', { type: 'stolen' }, 'type'],
    ['unknown category', { category: 'spaceship' }, 'category'],
    ['unknown status', { status: 'banana' }, 'status'],
    ['unknown statusBeforeHidden', { statusBeforeHidden: 'banana' }, 'statusBeforeHidden'],
    ['invalid date', { date: 'not a date' }, 'date'],
  ])('rejects %s', async (_label, overrides, field) => {
    expect(await errorsOf(build(overrides))).toEqual([field]);
  });

  it('accepts every category of the shared list', async () => {
    for (const category of CATEGORY_KEYS) {
      await expect(build({ category }).validate()).resolves.toBeUndefined();
    }
  });

  it('accepts statusBeforeHidden when hidden', async () => {
    const doc = build({ status: 'hidden', statusBeforeHidden: 'matched' });

    await expect(doc.validate()).resolves.toBeUndefined();
  });

  it('keeps short string attributes and rejects a long one', async () => {
    const ok = build({ attributes: { brand: 'Nike', color: 'black' } });
    await expect(ok.validate()).resolves.toBeUndefined();
    expect(await errorsOf(build({ attributes: { brand: 'a'.repeat(101) } }))).toEqual([
      'attributes.brand',
    ]);
  });

  it('serializes attributes as a plain object and drops __v', () => {
    const json = JSON.parse(JSON.stringify(build({ attributes: { brand: 'Nike' } })));

    expect(json.attributes).toEqual({ brand: 'Nike' });
    expect(json.__v).toBeUndefined();
  });

  it('hides privateInfo from queries by default', () => {
    expect(Declaration.schema.path('privateInfo').options.select).toBe(false);
  });

  it('declares the two indexes the other binomes rely on', () => {
    const keys = Declaration.schema.indexes().map(([fields]) => fields);

    expect(keys).toContainEqual({ type: 1, category: 1, status: 1, date: -1 });
    expect(keys).toContainEqual({ owner: 1, createdAt: -1 });
  });
});
