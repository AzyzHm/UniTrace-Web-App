import { describe, expect, it } from 'vitest';
import { updateDeclarationSchema } from '../../../src/validators/declarations/declaration.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

function fieldsInError(input) {
  const { error } = updateDeclarationSchema.validate(input, OPTIONS);
  return error ? [...new Set(error.details.map((d) => d.path[0]))] : [];
}

describe('update declaration schema', () => {
  it.each([
    ['title', 'Blue backpack'],
    ['description', 'Blue Nike backpack with a red keychain.'],
    ['date', '2026-10-13'],
    ['location', 'Cafeteria'],
    ['category', 'keys'],
    ['attributes', { color: 'blue' }],
  ])('accepts %s alone', (field, value) => {
    const { error } = updateDeclarationSchema.validate({ [field]: value }, OPTIONS);

    expect(error).toBeUndefined();
  });

  it('accepts every editable field together and cleans the text', () => {
    const { value, error } = updateDeclarationSchema.validate(
      {
        title: '  Blue backpack ',
        description: ' Blue Nike backpack with a red keychain. ',
        date: '2026-10-13',
        location: ' Cafeteria ',
        category: 'keys',
        attributes: { color: ' blue ' },
      },
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value.title).toBe('Blue backpack');
    expect(value.location).toBe('Cafeteria');
    expect(value.attributes).toEqual({ color: 'blue' });
    expect(value.date).toBeInstanceOf(Date);
  });

  it('accepts an empty attributes object, to clear them', () => {
    const { value, error } = updateDeclarationSchema.validate({ attributes: {} }, OPTIONS);

    expect(error).toBeUndefined();
    expect(value.attributes).toEqual({});
  });

  it('refuses an empty body with one clear message', () => {
    const { error } = updateDeclarationSchema.validate({}, OPTIONS);

    expect(error.details).toHaveLength(1);
    expect(error.details[0].message).toMatch(/At least one field to update is required/);
  });

  it.each(['type', 'owner', 'status', 'picture', 'privateInfo', 'deletedAt', 'statusBeforeHidden'])(
    'refuses %s, it is not editable here',
    (field) => {
      const input = { title: 'Blue backpack', [field]: 'lost' };

      expect(fieldsInError(input)).toEqual([field]);
    },
  );

  it('refuses a field it has never heard of', () => {
    expect(fieldsInError({ title: 'Blue backpack', colour: 'blue' })).toEqual(['colour']);
  });

  it.each([
    ['title', 'ab'],
    ['title', 'x'.repeat(101)],
    ['title', 42],
    ['description', 'too short'],
    ['description', 'x'.repeat(1001)],
    ['date', 'yesterday'],
    ['date', '2026-02-31'],
    ['date', '2999-01-01'],
    ['location', 'x'],
    ['location', 'x'.repeat(151)],
    ['category', 'spaceship'],
    ['attributes', 'brand=Nike'],
    ['attributes', { 'bad key': 'x' }],
    ['attributes', { brand: 'x'.repeat(101) }],
  ])('refuses a bad %s (%#)', (field, value) => {
    expect(fieldsInError({ [field]: value })).toEqual([field]);
  });

  it('refuses a null, a field is changed or left out, never emptied', () => {
    expect(fieldsInError({ title: null })).toEqual(['title']);
  });

  it('lists every bad field at once', () => {
    expect(
      fieldsInError({ title: 'ab', category: 'spaceship', status: 'resolved' }).sort(),
    ).toEqual(['category', 'status', 'title']);
  });
});
