import { describe, expect, it } from 'vitest';
import { listMyDeclarationsQuerySchema } from '../../../src/validators/declarations/declaration.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false, convert: true };

const run = (query) => listMyDeclarationsQuerySchema.validate(query, OPTIONS);
const fieldsInError = (query) => {
  const { error } = run(query);
  return error ? [...new Set(error.details.map((d) => d.path.join('.')))] : [];
};

describe('list my declarations query schema', () => {
  it('applies the defaults to an empty query', () => {
    const { value, error } = run({});

    expect(error).toBeUndefined();
    expect(value).toEqual({ page: 1, limit: 20 });
  });

  it('converts the text of the query string to numbers', () => {
    const { value, error } = run({ page: '3', limit: '10' });

    expect(error).toBeUndefined();
    expect(value).toEqual({ page: 3, limit: 10 });
  });

  it('accepts a type and a status', () => {
    const { value, error } = run({ type: 'found', status: 'matched' });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({ type: 'found', status: 'matched' });
  });

  it('accepts the biggest allowed limit and refuses one more', () => {
    expect(run({ limit: '50' }).error).toBeUndefined();
    expect(fieldsInError({ limit: '51' })).toEqual(['limit']);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('refuses the page "%s"', (page) => {
    expect(fieldsInError({ page })).toEqual(['page']);
  });

  it.each(['0', '-5', '2.5', 'ten', ''])('refuses the limit "%s"', (limit) => {
    expect(fieldsInError({ limit })).toEqual(['limit']);
  });

  it('refuses a type that is not lost or found', () => {
    expect(fieldsInError({ type: 'stolen' })).toEqual(['type']);
  });

  it('refuses an unknown status', () => {
    expect(fieldsInError({ status: 'archived' })).toEqual(['status']);
  });

  it('refuses the status deleted, a deleted declaration is never listed', () => {
    expect(fieldsInError({ status: 'deleted' })).toEqual(['status']);
  });

  it.each(['pending', 'matched', 'resolved', 'expired', 'hidden'])(
    'accepts the status %s',
    (status) => {
      expect(run({ status }).error).toBeUndefined();
    },
  );

  it('refuses a repeated parameter, which arrives as an array', () => {
    expect(fieldsInError({ type: ['lost', 'found'] })).toEqual(['type']);
  });

  it('refuses a query object used to inject an operator', () => {
    expect(fieldsInError({ status: { $ne: 'deleted' } })).toEqual(['status']);
  });

  it('refuses unknown parameters', () => {
    expect(fieldsInError({ owner: '507f1f77bcf86cd799439011', sort: 'title' })).toEqual([
      'owner',
      'sort',
    ]);
  });
});
