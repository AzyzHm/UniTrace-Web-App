import { describe, expect, it } from 'vitest';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../../../src/validators/auth/auth.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

function build(overrides = {}) {
  return {
    email: 'sara@isamm.uma.tn',
    code: '123456',
    newPassword: 'Secret123',
    confirmPassword: 'Secret123',
    ...overrides,
  };
}

function fieldsInError(schema, input) {
  const { error } = schema.validate(input, OPTIONS);
  return error ? error.details.map((d) => d.path.join('.')) : [];
}

describe('forgot password schema', () => {
  it('accepts a valid email and lowercases it', () => {
    const { value, error } = forgotPasswordSchema.validate({ email: ' Sara@ISAMM.uma.tn ' });

    expect(error).toBeUndefined();
    expect(value).toEqual({ email: 'sara@isamm.uma.tn' });
  });

  it('requires an email, and rejects a malformed one', () => {
    expect(fieldsInError(forgotPasswordSchema, {})).toEqual(['email']);
    expect(fieldsInError(forgotPasswordSchema, { email: 'nope' })).toEqual(['email']);
  });

  it('rejects unknown fields', () => {
    expect(
      fieldsInError(forgotPasswordSchema, { email: 'sara@isamm.uma.tn', role: 'admin' }),
    ).toEqual(['role']);
  });
});

describe('reset password schema', () => {
  it('accepts valid input, cleans it and drops confirmPassword', () => {
    const { value, error } = resetPasswordSchema.validate(
      build({ email: '  Sara@ISAMM.uma.tn ', code: ' 123456 ' }),
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value).toEqual({
      email: 'sara@isamm.uma.tn',
      code: '123456',
      newPassword: 'Secret123',
    });
  });

  it('keeps a leading zero in the code', () => {
    const { value } = resetPasswordSchema.validate(build({ code: '012345' }), OPTIONS);

    expect(value.code).toBe('012345');
  });

  it.each(['12345', '1234567', '12ab56', '12 456', ''])('rejects the code "%s"', (code) => {
    expect(fieldsInError(resetPasswordSchema, build({ code }))).toEqual(['code']);
  });

  it('rejects a numeric code, so leading zeros cannot be lost', () => {
    expect(fieldsInError(resetPasswordSchema, build({ code: 123456 }))).toEqual(['code']);
  });

  it.each([
    ['too short', 'abc12'],
    ['no digit', 'abcdefgh'],
    ['no letter', '12345678'],
    ['over 72 characters', `a1${'x'.repeat(71)}`],
  ])('rejects a new password that is %s', (_label, newPassword) => {
    expect(
      fieldsInError(resetPasswordSchema, build({ newPassword, confirmPassword: newPassword })),
    ).toEqual(['newPassword']);
  });

  it('rejects a mismatched confirmPassword', () => {
    expect(fieldsInError(resetPasswordSchema, build({ confirmPassword: 'Other123' }))).toEqual([
      'confirmPassword',
    ]);
  });

  it('does not accept the field name "password", only "newPassword"', () => {
    expect(fieldsInError(resetPasswordSchema, build({ password: 'Secret123' }))).toEqual([
      'password',
    ]);
  });

  it('rejects a malformed email', () => {
    expect(fieldsInError(resetPasswordSchema, build({ email: 'nope' }))).toEqual(['email']);
  });

  it('requires every field and reports them all at once', () => {
    expect(fieldsInError(resetPasswordSchema, {}).sort()).toEqual([
      'code',
      'confirmPassword',
      'email',
      'newPassword',
    ]);
  });
});
