import { describe, expect, it } from 'vitest';
import { createDeclarationSchema } from '../../../src/validators/declarations/declaration.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

const VALID = {
  title: 'Black backpack',
  type: 'lost',
  description: 'Black Nike backpack with a red keychain.',
  date: '2026-10-12',
  location: 'Main library, 2nd floor',
  category: 'wallet_bag',
};

function fieldsInError(input) {
  const { error } = createDeclarationSchema.validate(input, OPTIONS);
  return error ? [...new Set(error.details.map((d) => d.path.join('.')))] : [];
}

describe('create declaration schema', () => {
  it('accepts the six required fields', () => {
    const { error } = createDeclarationSchema.validate(VALID, OPTIONS);

    expect(error).toBeUndefined();
  });

  it('accepts the optional fields and cleans the text', () => {
    const { value, error } = createDeclarationSchema.validate(
      {
        ...VALID,
        title: '  Black backpack ',
        location: ' Library ',
        attributes: { brand: ' Nike ', color: 'black' },
        privateInfo: ' Name on page 1 ',
      },
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value.title).toBe('Black backpack');
    expect(value.location).toBe('Library');
    expect(value.attributes).toEqual({ brand: 'Nike', color: 'black' });
    expect(value.privateInfo).toBe('Name on page 1');
  });

  it('turns the date into a Date', () => {
    const { value } = createDeclarationSchema.validate(VALID, OPTIONS);

    expect(value.date).toBeInstanceOf(Date);
    expect(value.date.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('lists every missing required field at once', () => {
    expect(fieldsInError({}).sort()).toEqual(
      ['category', 'date', 'description', 'location', 'title', 'type'].sort(),
    );
  });

  it.each([
    ['a short title', { title: 'ab' }, 'title'],
    ['a long title', { title: 'a'.repeat(101) }, 'title'],
    ['a short description', { description: 'too short' }, 'description'],
    ['a long description', { description: 'a'.repeat(1001) }, 'description'],
    ['a short location', { location: 'a' }, 'location'],
    ['a long location', { location: 'a'.repeat(151) }, 'location'],
    ['an unknown type', { type: 'stolen' }, 'type'],
    ['an unknown category', { category: 'spaceship' }, 'category'],
    ['a long privateInfo', { privateInfo: 'a'.repeat(501) }, 'privateInfo'],
    ['an empty privateInfo', { privateInfo: '' }, 'privateInfo'],
  ])('refuses %s', (_label, override, field) => {
    expect(fieldsInError({ ...VALID, ...override })).toEqual([field]);
  });

  it('refuses a title that is only spaces', () => {
    expect(fieldsInError({ ...VALID, title: '     ' })).toEqual(['title']);
  });

  describe('date', () => {
    it('accepts a full ISO timestamp in the past', () => {
      expect(fieldsInError({ ...VALID, date: '2026-10-12T14:30:00.000Z' })).toEqual([]);
    });

    it('accepts now', () => {
      expect(fieldsInError({ ...VALID, date: new Date().toISOString() })).toEqual([]);
    });

    it('refuses a date in the future, with a clear message', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { error } = createDeclarationSchema.validate({ ...VALID, date: tomorrow }, OPTIONS);

      expect(error.details).toHaveLength(1);
      expect(error.details[0].message).toBe('Date cannot be in the future');
    });

    it('accepts the 29th of February of a leap year, and keeps the written day', () => {
      const { value, error } = createDeclarationSchema.validate(
        { ...VALID, date: '2024-02-29' },
        OPTIONS,
      );

      expect(error).toBeUndefined();
      expect(value.date.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    });

    it.each([
      ['free text', 'yesterday'],
      ['a timestamp number', 1760000000000],
      ['an object', { $gt: '' }],
      ['a month 13', '2026-13-01'],
      ['the 31st of February, which would silently become March', '2026-02-31'],
      ['the 29th of February of a normal year', '2026-02-29'],
      ['the 31st of April', '2026-04-31'],
      ['an impossible day with a time', '2026-02-30T10:00:00Z'],
      ['an hour 25', '2026-10-12T25:00:00Z'],
      ['the compact form without dashes', '20261012'],
    ])('refuses %s', (_label, date) => {
      expect(fieldsInError({ ...VALID, date })).toEqual(['date']);
    });
  });

  describe('attributes', () => {
    it('refuses a value that is not a string', () => {
      expect(fieldsInError({ ...VALID, attributes: { brand: 5 } })).toEqual(['attributes.brand']);
    });

    it('refuses a value over the limit', () => {
      expect(fieldsInError({ ...VALID, attributes: { brand: 'a'.repeat(101) } })).toEqual([
        'attributes.brand',
      ]);
    });

    it.each(['$brand', 'a.b', '1brand', 'br and'])('refuses the key "%s"', (key) => {
      const attributes = JSON.parse(`{ ${JSON.stringify(key)}: "x" }`);

      expect(fieldsInError({ ...VALID, attributes })).toEqual([`attributes.${key}`]);
    });

    it('drops a "__proto__" key instead of passing it on', () => {
      const attributes = JSON.parse('{ "__proto__": { "polluted": "yes" }, "brand": "Nike" }');

      const { value } = createDeclarationSchema.validate({ ...VALID, attributes }, OPTIONS);

      expect(Object.keys(value.attributes)).toEqual(['brand']);
      expect(Object.getPrototypeOf(value.attributes)).toBe(Object.prototype);
      expect({}.polluted).toBeUndefined();
    });

    it('refuses more than ten attributes', () => {
      const attributes = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'x']));

      expect(fieldsInError({ ...VALID, attributes })).toEqual(['attributes']);
    });

    it('refuses an array', () => {
      expect(fieldsInError({ ...VALID, attributes: ['Nike'] })).toEqual(['attributes']);
    });
  });

  it.each(['status', 'owner', 'deletedAt', 'statusBeforeHidden', 'picture', '_id', 'createdAt'])(
    'refuses the field "%s", which a user must never set',
    (field) => {
      expect(fieldsInError({ ...VALID, [field]: 'x' })).toEqual([field]);
    },
  );

  it('refuses operator objects instead of strings', () => {
    expect(fieldsInError({ ...VALID, title: { $ne: '' } })).toEqual(['title']);
    expect(fieldsInError({ ...VALID, category: { $in: ['phone'] } })).toEqual(['category']);
  });
});
