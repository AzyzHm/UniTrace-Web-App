import { describe, expect, it } from 'vitest';
import { declarationIdParamsSchema } from '../../../src/validators/declarations/declaration.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false, convert: true };

const run = (params) => declarationIdParamsSchema.validate(params, OPTIONS);
const fieldsInError = (params) => {
  const { error } = run(params);
  return error ? [...new Set(error.details.map((d) => d.path.join('.')))] : [];
};

describe('declaration id params schema', () => {
  it('accepts an ObjectId written in lowercase', () => {
    const { value, error } = run({ id: '507f1f77bcf86cd799439011' });

    expect(error).toBeUndefined();
    expect(value).toEqual({ id: '507f1f77bcf86cd799439011' });
  });

  it('accepts an ObjectId written in uppercase', () => {
    expect(run({ id: '507F1F77BCF86CD799439011' }).error).toBeUndefined();
  });

  it.each([
    ['too short', '507f1f77bcf86cd79943901'],
    ['too long', '507f1f77bcf86cd7994390111'],
    ['not hexadecimal', '507f1f77bcf86cd79943901z'],
    ['12 characters, which Mongoose would still cast', 'abcdefghijkl'],
    ['a word', 'abc'],
    ['empty', ''],
    ['with spaces around', ' 507f1f77bcf86cd799439011 '],
  ])('refuses an id that is %s', (_label, id) => {
    expect(fieldsInError({ id })).toEqual(['id']);
  });

  it('refuses a missing id', () => {
    expect(fieldsInError({})).toEqual(['id']);
  });

  it.each(['abc', 'xyz!', '', ' 507f1f77bcf86cd799439011'])(
    'gives exactly one clear message for the malformed id "%s"',
    (id) => {
      const { error } = run({ id });

      expect(error.details.map((d) => d.message)).toEqual(['id must be a valid declaration id']);
    },
  );

  it('refuses an object used to inject an operator', () => {
    expect(fieldsInError({ id: { $ne: null } })).toEqual(['id']);
  });

  it('refuses unknown params', () => {
    expect(fieldsInError({ id: '507f1f77bcf86cd799439011', owner: 'x' })).toEqual(['owner']);
  });
});
