import { describe, expect, it } from 'vitest';
import { createUpdateProfileSchema } from '../../../src/validators/users/user.validator.js';

const schema = createUpdateProfileSchema({ allowedEmailDomains: ['isamm.uma.tn'] });

const OPTIONS = { abortEarly: false, allowUnknown: false };

function fieldsInError(input) {
  const { error } = schema.validate(input, OPTIONS);
  return error ? error.details.map((d) => d.path.join('.')) : [];
}

describe('update profile schema', () => {
  it('accepts a single field and cleans it', () => {
    const { value, error } = schema.validate({ email: '  Omar@ISAMM.uma.tn ' }, OPTIONS);

    expect(error).toBeUndefined();
    expect(value).toEqual({ email: 'omar@isamm.uma.tn' });
  });

  it('accepts all three fields together', () => {
    const { value, error } = schema.validate(
      { username: ' omar.b ', email: 'omar@isamm.uma.tn', phone: ' +21655000000 ' },
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value).toEqual({
      username: 'omar.b',
      email: 'omar@isamm.uma.tn',
      phone: '+21655000000',
    });
  });

  it('accepts null as a way to remove the phone number', () => {
    const { value, error } = schema.validate({ phone: null }, OPTIONS);

    expect(error).toBeUndefined();
    expect(value).toEqual({ phone: null });
  });

  it('refuses an empty phone string, so there is only one way to clear it', () => {
    expect(fieldsInError({ phone: '' })).toEqual(['phone']);
  });

  it('refuses an empty body', () => {
    const { error } = schema.validate({}, OPTIONS);

    expect(error.details).toHaveLength(1);
    expect(error.details[0].message).toBe('Send at least one field to update');
  });

  it('refuses an email outside the university domains', () => {
    const { error } = schema.validate({ email: 'omar@gmail.com' }, OPTIONS);

    expect(error.details).toHaveLength(1);
    expect(error.details[0].message).toBe('Please use your university email address');
  });

  it('gives only the format error for a malformed email', () => {
    expect(fieldsInError({ email: 'not-an-email' })).toEqual(['email']);
  });

  it.each([
    ['a short username', { username: 'ab' }, 'username'],
    ['a username with a space', { username: 'omar b' }, 'username'],
    ['a malformed phone', { phone: '12345' }, 'phone'],
  ])('refuses %s', (_label, input, field) => {
    expect(fieldsInError(input)).toEqual([field]);
  });

  it.each(['role', 'isActive', 'isEmailVerified', 'password', 'deletedAt', '_id'])(
    'refuses the field "%s", which a user must never set here',
    (field) => {
      const { error } = schema.validate({ username: 'omar.b', [field]: 'x' }, OPTIONS);

      expect(error.details.map((d) => d.path.join('.'))).toEqual([field]);
    },
  );

  it('refuses a value that is not a string, which blocks operator objects', () => {
    expect(fieldsInError({ email: { $ne: '' } })).toEqual(['email']);
    expect(fieldsInError({ username: { $gt: '' } })).toEqual(['username']);
  });
});
