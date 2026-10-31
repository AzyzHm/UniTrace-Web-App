import { describe, expect, it } from 'vitest';
import { changePasswordSchema } from '../../../src/validators/users/user.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false };

function build(overrides = {}) {
  return {
    currentPassword: 'Secret123',
    newPassword: 'Brandnew456',
    confirmPassword: 'Brandnew456',
    ...overrides,
  };
}

function errorsOf(input) {
  const { error } = changePasswordSchema.validate(input, OPTIONS);
  return error ? error.details.map((d) => ({ field: d.path.join('.'), message: d.message })) : [];
}

describe('change password schema', () => {
  it('accepts valid input and drops confirmPassword', () => {
    const { value, error } = changePasswordSchema.validate(build(), OPTIONS);

    expect(error).toBeUndefined();
    expect(value).toEqual({ currentPassword: 'Secret123', newPassword: 'Brandnew456' });
  });

  it('does not trim passwords, so spaces are part of them', () => {
    const { value, error } = changePasswordSchema.validate(
      build({
        currentPassword: ' Secret123 ',
        newPassword: ' Brandnew456',
        confirmPassword: ' Brandnew456',
      }),
      OPTIONS,
    );

    expect(error).toBeUndefined();
    expect(value.currentPassword).toBe(' Secret123 ');
    expect(value.newPassword).toBe(' Brandnew456');
  });

  it('accepts an old current password that would fail the strength rules today', () => {
    expect(errorsOf(build({ currentPassword: 'old' }))).toEqual([]);
  });

  it.each(['currentPassword', 'newPassword', 'confirmPassword'])('requires %s', (field) => {
    const input = build();
    delete input[field];

    expect(errorsOf(input).map((e) => e.field)).toContain(field);
  });

  it.each([
    ['too short', 'short1'],
    ['without a digit', 'Onlyletters'],
    ['without a letter', '12345678'],
    ['longer than 72 characters', `A1${'x'.repeat(71)}`],
  ])('refuses a new password %s', (_label, newPassword) => {
    const fields = errorsOf(build({ newPassword, confirmPassword: newPassword })).map(
      (e) => e.field,
    );

    expect(fields).toEqual(['newPassword']);
  });

  it('refuses a new password equal to the current one', () => {
    expect(errorsOf(build({ newPassword: 'Secret123', confirmPassword: 'Secret123' }))).toEqual([
      { field: 'newPassword', message: 'New password must be different from the current password' },
    ]);
  });

  it('refuses a mismatched confirmPassword', () => {
    expect(errorsOf(build({ confirmPassword: 'Other123' }))).toEqual([
      { field: 'confirmPassword', message: 'Passwords do not match' },
    ]);
  });

  it('refuses a current password longer than 72 characters', () => {
    expect(errorsOf(build({ currentPassword: 'x'.repeat(73) })).map((e) => e.field)).toEqual([
      'currentPassword',
    ]);
  });

  it.each(['password', 'email', 'role', 'userId'])('refuses the unknown field "%s"', (field) => {
    expect(errorsOf(build({ [field]: 'x' })).map((e) => e.field)).toEqual([field]);
  });

  it('refuses values that are not strings, which blocks operator objects', () => {
    expect(errorsOf(build({ currentPassword: { $ne: '' } })).map((e) => e.field)).toEqual([
      'currentPassword',
    ]);
  });
});
