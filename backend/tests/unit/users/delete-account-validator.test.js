import { describe, expect, it } from 'vitest';
import { deleteAccountSchema } from '../../../src/validators/users/user.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

function fieldsInError(input) {
  const { error } = deleteAccountSchema.validate(input, OPTIONS);
  return error ? error.details.map((d) => d.path.join('.')) : [];
}

describe('delete account schema', () => {
  it('accepts a password and keeps it exactly as sent', () => {
    const { value, error } = deleteAccountSchema.validate({ password: ' Secret123 ' }, OPTIONS);

    expect(error).toBeUndefined();
    expect(value).toEqual({ password: ' Secret123 ' });
  });

  it('accepts an old password that would fail the strength rules today', () => {
    expect(fieldsInError({ password: 'old' })).toEqual([]);
  });

  it.each([
    ['an empty body', {}],
    ['an empty password', { password: '' }],
  ])('refuses %s', (_label, input) => {
    expect(fieldsInError(input)).toEqual(['password']);
  });

  it('refuses a password longer than 72 characters', () => {
    expect(fieldsInError({ password: 'x'.repeat(73) })).toEqual(['password']);
  });

  it('refuses a value that is not a string, which blocks operator objects', () => {
    expect(fieldsInError({ password: { $ne: '' } })).toEqual(['password']);
  });

  it.each(['email', 'userId', 'confirm'])('refuses the unknown field "%s"', (field) => {
    expect(fieldsInError({ password: 'Secret123', [field]: 'x' })).toEqual([field]);
  });
});
