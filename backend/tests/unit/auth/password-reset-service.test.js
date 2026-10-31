import { describe, expect, it, vi } from 'vitest';
import { InvalidCodeError, RateLimitedError } from '../../../src/exceptions/app-error.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';
import { createPasswordResetService } from '../../../src/services/auth/password-reset.service.js';

const USER = {
  _id: '507f1f77bcf86cd799439011',
  email: 'sara@isamm.uma.tn',
  isActive: true,
  deletedAt: null,
  isEmailVerified: true,
};
const INPUT = { email: USER.email, code: '123456', newPassword: 'Brandnew456' };

function setup({ user = USER, verify, updatePassword, issue } = {}) {
  const userRepository = {
    findByEmail: vi.fn().mockResolvedValue(user),
    updatePassword: updatePassword ?? vi.fn().mockResolvedValue(USER),
  };
  const passwordHasher = { hash: vi.fn().mockResolvedValue('new-hash') };
  const verificationCodeService = {
    issue: issue ?? vi.fn().mockResolvedValue(undefined),
    verify: verify ?? vi.fn().mockResolvedValue(undefined),
  };
  const refreshTokenRepository = { deleteAllForUser: vi.fn().mockResolvedValue(undefined) };
  const service = createPasswordResetService({
    userRepository,
    passwordHasher,
    verificationCodeService,
    refreshTokenRepository,
  });

  return {
    service,
    userRepository,
    passwordHasher,
    verificationCodeService,
    refreshTokenRepository,
  };
}

const callOrder = (fn) => fn.mock.invocationCallOrder[0];

describe('password reset service, creation', () => {
  it.each([
    'userRepository',
    'passwordHasher',
    'verificationCodeService',
    'refreshTokenRepository',
  ])('refuses to start without %s', (missing) => {
    const dependencies = {
      userRepository: {},
      passwordHasher: {},
      verificationCodeService: {},
      refreshTokenRepository: {},
    };
    delete dependencies[missing];

    expect(() => createPasswordResetService(dependencies)).toThrow(new RegExp(missing));
  });
});

describe('password reset service, requestReset', () => {
  it('issues a password reset code for the account', async () => {
    const { service, verificationCodeService } = setup();

    await service.requestReset({ email: USER.email });

    expect(verificationCodeService.issue).toHaveBeenCalledWith({
      userId: USER._id,
      email: USER.email,
      purpose: 'password_reset',
    });
  });

  it('also works for an account whose email is not verified yet', async () => {
    const { service, verificationCodeService } = setup({
      user: { ...USER, isEmailVerified: false },
    });

    await service.requestReset({ email: USER.email });

    expect(verificationCodeService.issue).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown email', null],
    ['a deleted account', { ...USER, deletedAt: new Date() }],
    ['a suspended account', { ...USER, isActive: false }],
  ])('does nothing for %s', async (_label, user) => {
    const { service, verificationCodeService } = setup({ user });

    await expect(service.requestReset({ email: USER.email })).resolves.toBeUndefined();
    expect(verificationCodeService.issue).not.toHaveBeenCalled();
  });

  it('lets the cooldown error reach the caller', async () => {
    const issue = vi
      .fn()
      .mockRejectedValue(new RateLimitedError('wait', { retryAfterSeconds: 90 }));
    const { service } = setup({ issue });

    await expect(service.requestReset({ email: USER.email })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('lets a delivery failure reach the caller', async () => {
    const issue = vi.fn().mockRejectedValue(new EmailDeliveryError('provider down'));
    const { service } = setup({ issue });

    await expect(service.requestReset({ email: USER.email })).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
  });
});

describe('password reset service, resetPassword', () => {
  it('checks the code, hashes, saves the hash, then ends every session, in that order', async () => {
    const {
      service,
      userRepository,
      passwordHasher,
      verificationCodeService,
      refreshTokenRepository,
    } = setup();

    await service.resetPassword(INPUT);

    expect(verificationCodeService.verify).toHaveBeenCalledWith({
      userId: USER._id,
      purpose: 'password_reset',
      code: '123456',
    });
    expect(passwordHasher.hash).toHaveBeenCalledWith('Brandnew456');
    expect(userRepository.updatePassword).toHaveBeenCalledWith(USER._id, 'new-hash');
    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith(USER._id);

    expect(callOrder(verificationCodeService.verify)).toBeLessThan(callOrder(passwordHasher.hash));
    expect(callOrder(passwordHasher.hash)).toBeLessThan(callOrder(userRepository.updatePassword));
    expect(callOrder(userRepository.updatePassword)).toBeLessThan(
      callOrder(refreshTokenRepository.deleteAllForUser),
    );
  });

  it('answers an unknown email like a wrong code, and checks nothing', async () => {
    const { service, verificationCodeService, passwordHasher } = setup({ user: null });

    await expect(service.resetPassword(INPUT)).rejects.toBeInstanceOf(InvalidCodeError);
    expect(verificationCodeService.verify).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
  });

  it.each([
    ['a deleted account', { ...USER, deletedAt: new Date() }],
    ['a suspended account', { ...USER, isActive: false }],
  ])('answers %s like a wrong code, and consumes nothing', async (_label, user) => {
    const { service, verificationCodeService, userRepository } = setup({ user });

    await expect(service.resetPassword(INPUT)).rejects.toBeInstanceOf(InvalidCodeError);
    expect(verificationCodeService.verify).not.toHaveBeenCalled();
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
  });

  it('does nothing more when the code is wrong', async () => {
    const verify = vi.fn().mockRejectedValue(new InvalidCodeError());
    const { service, passwordHasher, userRepository, refreshTokenRepository } = setup({ verify });

    await expect(service.resetPassword(INPUT)).rejects.toBeInstanceOf(InvalidCodeError);
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });

  it('fails with the same error, and ends no session, when the user cannot be updated', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null);
    const { service, refreshTokenRepository } = setup({ updatePassword });

    await expect(service.resetPassword(INPUT)).rejects.toBeInstanceOf(InvalidCodeError);
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });
});
