import { describe, expect, it } from 'vitest';
import { loginSchema } from '../../../src/validators/auth/auth.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

function fieldsInError(input) {
  const { error } = loginSchema.validate(input, OPTIONS);
  return error ? error.details.map((d) => d.path.join('.')) : [];
}

describe('login schema', () => {
  it('cleans the email and leaves the password exactly as typed', () => {
    const { value, error } = loginSchema.validate(
      { email: '  Sara@ISAMM.uma.tn ', password: ' Secret123 ' },
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value).toEqual({ email: 'sara@isamm.uma.tn', password: ' Secret123 ' });
  });

  it('applies no strength rules, so an older password still works', () => {
    expect(fieldsInError({ email: 'sara@isamm.uma.tn', password: 'a' })).toEqual([]);
  });

  it('requires both fields and rejects an empty password', () => {
    expect(fieldsInError({}).sort()).toEqual(['email', 'password']);
    expect(fieldsInError({ email: 'sara@isamm.uma.tn', password: '' })).toEqual(['password']);
  });

  it('rejects a password over 72 characters', () => {
    expect(fieldsInError({ email: 'sara@isamm.uma.tn', password: 'x'.repeat(73) })).toEqual([
      'password',
    ]);
  });

  it('rejects a malformed email', () => {
    expect(fieldsInError({ email: 'nope', password: 'Secret123' })).toEqual(['email']);
  });

  it('rejects unknown fields', () => {
    expect(
      fieldsInError({ email: 'sara@isamm.uma.tn', password: 'Secret123', role: 'admin' }),
    ).toEqual(['role']);
  });
});
