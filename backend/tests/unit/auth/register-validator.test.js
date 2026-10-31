import { describe, expect, it } from 'vitest';
import { createRegisterSchema } from '../../../src/validators/auth/auth.validator.js';

const schema = createRegisterSchema({
  allowedEmailDomains: ['isamm.uma.tn', 'isamm.u-manouba.tn'],
});

const OPTIONS = { abortEarly: false, allowUnknown: false };

function build(overrides = {}) {
  return {
    username: 'sara.k',
    email: 'sara@isamm.uma.tn',
    password: 'Secret123',
    confirmPassword: 'Secret123',
    ...overrides,
  };
}

function fieldsInError(input) {
  const { error } = schema.validate(input, OPTIONS);
  return error ? error.details.map((d) => d.path.join('.')) : [];
}

describe('register schema', () => {
  it('accepts valid input, cleans it and drops confirmPassword', () => {
    const { value, error } = schema.validate(
      build({ username: '  sara.k ', email: '  Sara@ISAMM.uma.tn ' }),
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value).toEqual({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password: 'Secret123',
    });
  });

  it('accepts an optional phone', () => {
    expect(fieldsInError(build({ phone: '+21612345678' }))).toEqual([]);
  });

  it('rejects unknown fields such as role', () => {
    expect(fieldsInError(build({ role: 'admin' }))).toEqual(['role']);
  });

  it('rejects mismatched confirmPassword', () => {
    expect(fieldsInError(build({ confirmPassword: 'Other123' }))).toEqual(['confirmPassword']);
  });

  it('requires confirmPassword', () => {
    const input = build();
    delete input.confirmPassword;

    expect(fieldsInError(input)).toContain('confirmPassword');
  });

  it.each([
    ['too short', 'abc12'],
    ['no digit', 'abcdefgh'],
    ['no letter', '12345678'],
    ['over 72 characters', `a1${'x'.repeat(71)}`],
  ])('rejects a password that is %s', (_label, password) => {
    expect(fieldsInError(build({ password, confirmPassword: password }))).toEqual(['password']);
  });

  it.each(['ab', 'has space', 'bad!char', 'x'.repeat(31)])('rejects username %s', (username) => {
    expect(fieldsInError(build({ username }))).toEqual(['username']);
  });

  it.each(['12', 'abcdefgh', '+216 123 456 78', '1'.repeat(16)])('rejects phone %s', (phone) => {
    expect(fieldsInError(build({ phone }))).toEqual(['phone']);
  });

  it('rejects an invalid email format', () => {
    expect(fieldsInError(build({ email: 'not-an-email' }))).toEqual(['email']);
  });

  it('accepts both configured university domains', () => {
    expect(fieldsInError(build({ email: 'a@isamm.u-manouba.tn' }))).toEqual([]);
  });

  it.each([
    'sara@gmail.com',
    'sara@isamm.uma.tn.evil.com',
    'sara@evil-isamm.uma.tn',
    'sara@sub.isamm.uma.tn',
  ])('rejects the email %s, not an exact university domain', (email) => {
    expect(fieldsInError(build({ email }))).toEqual(['email']);
  });

  it('reports every problem at once', () => {
    expect(fieldsInError({}).sort()).toEqual(['confirmPassword', 'email', 'password', 'username']);
  });
});
