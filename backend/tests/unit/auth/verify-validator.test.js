import { describe, expect, it } from 'vitest';
import {
  resendVerificationSchema,
  verifyEmailSchema,
} from '../../../src/validators/auth/auth.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

function fieldsInError(schema, input) {
  const { error } = schema.validate(input, OPTIONS);
  return error ? error.details.map((d) => d.path.join('.')) : [];
}

describe('verify email schema', () => {
  it('accepts valid input and cleans it', () => {
    const { value, error } = verifyEmailSchema.validate(
      { email: '  Sara@ISAMM.uma.tn ', code: ' 012345 ' },
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value).toEqual({ email: 'sara@isamm.uma.tn', code: '012345' });
  });

  it.each(['12345', '1234567', '12ab56', '12 456', ''])('rejects the code "%s"', (code) => {
    expect(fieldsInError(verifyEmailSchema, { email: 'sara@isamm.uma.tn', code })).toEqual([
      'code',
    ]);
  });

  it('rejects a numeric code, so leading zeros cannot be lost', () => {
    expect(fieldsInError(verifyEmailSchema, { email: 'sara@isamm.uma.tn', code: 123456 })).toEqual([
      'code',
    ]);
  });

  it('rejects a malformed email', () => {
    expect(fieldsInError(verifyEmailSchema, { email: 'nope', code: '123456' })).toEqual(['email']);
  });

  it('rejects unknown fields', () => {
    expect(
      fieldsInError(verifyEmailSchema, {
        email: 'sara@isamm.uma.tn',
        code: '123456',
        isEmailVerified: true,
      }),
    ).toEqual(['isEmailVerified']);
  });

  it('requires both fields', () => {
    expect(fieldsInError(verifyEmailSchema, {}).sort()).toEqual(['code', 'email']);
  });
});

describe('resend verification schema', () => {
  it('accepts a valid email and lowercases it', () => {
    const { value, error } = resendVerificationSchema.validate({ email: 'Sara@ISAMM.uma.tn' });

    expect(error).toBeUndefined();
    expect(value).toEqual({ email: 'sara@isamm.uma.tn' });
  });

  it('requires an email and rejects extra fields', () => {
    expect(fieldsInError(resendVerificationSchema, {})).toEqual(['email']);
    expect(
      fieldsInError(resendVerificationSchema, { email: 'sara@isamm.uma.tn', code: '123456' }),
    ).toEqual(['code']);
  });
});
