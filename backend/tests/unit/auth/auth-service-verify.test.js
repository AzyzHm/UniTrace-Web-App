import { describe, expect, it, vi } from 'vitest';
import { InvalidCodeError, RateLimitedError } from '../../../src/exceptions/app-error.js';
import { createAuthService } from '../../../src/services/auth/auth.service.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';

const USER = {
  _id: '507f1f77bcf86cd799439011',
  email: 'sara@isamm.uma.tn',
  isEmailVerified: false,
};
const VERIFIED = { ...USER, isEmailVerified: true };

function setup({ user = USER, verify, markEmailVerified, issue } = {}) {
  const userRepository = {
    findByEmail: vi.fn().mockResolvedValue(user),
    markEmailVerified: markEmailVerified ?? vi.fn().mockResolvedValue(VERIFIED),
  };
  const verificationCodeService = {
    issue: issue ?? vi.fn().mockResolvedValue(undefined),
    verify: verify ?? vi.fn().mockResolvedValue(undefined),
  };
  const service = createAuthService({
    userRepository,
    passwordHasher: {},
    verificationCodeService,
  });

  return { service, userRepository, verificationCodeService };
}

describe('auth service, verifyEmail', () => {
  it('checks the code for that user and purpose, then marks the user verified', async () => {
    const { service, userRepository, verificationCodeService } = setup();

    const result = await service.verifyEmail({ email: USER.email, code: '123456' });

    expect(verificationCodeService.verify).toHaveBeenCalledWith({
      userId: USER._id,
      purpose: 'email_verification',
      code: '123456',
    });
    expect(userRepository.markEmailVerified).toHaveBeenCalledWith(USER._id);
    expect(result).toBe(VERIFIED);
  });

  it('answers an unknown email like a wrong code, and checks nothing', async () => {
    const { service, verificationCodeService } = setup({ user: null });

    await expect(
      service.verifyEmail({ email: 'x@isamm.uma.tn', code: '123456' }),
    ).rejects.toBeInstanceOf(InvalidCodeError);
    expect(verificationCodeService.verify).not.toHaveBeenCalled();
  });

  it('does not mark the user verified when the code is wrong', async () => {
    const verify = vi.fn().mockRejectedValue(new InvalidCodeError());
    const { service, userRepository } = setup({ verify });

    await expect(service.verifyEmail({ email: USER.email, code: '000000' })).rejects.toBeInstanceOf(
      InvalidCodeError,
    );
    expect(userRepository.markEmailVerified).not.toHaveBeenCalled();
  });

  it('fails with the same error when the user cannot be marked verified', async () => {
    const markEmailVerified = vi.fn().mockResolvedValue(null);
    const { service } = setup({ markEmailVerified });

    await expect(service.verifyEmail({ email: USER.email, code: '123456' })).rejects.toBeInstanceOf(
      InvalidCodeError,
    );
  });
});

describe('auth service, resendVerification', () => {
  it('issues a new email verification code', async () => {
    const { service, verificationCodeService } = setup();

    await service.resendVerification({ email: USER.email });

    expect(verificationCodeService.issue).toHaveBeenCalledWith({
      userId: USER._id,
      email: USER.email,
      purpose: 'email_verification',
    });
  });

  it('does nothing for an unknown email', async () => {
    const { service, verificationCodeService } = setup({ user: null });

    await expect(service.resendVerification({ email: 'x@isamm.uma.tn' })).resolves.toBeUndefined();
    expect(verificationCodeService.issue).not.toHaveBeenCalled();
  });

  it('does nothing for an already verified user', async () => {
    const { service, verificationCodeService } = setup({ user: VERIFIED });

    await expect(service.resendVerification({ email: USER.email })).resolves.toBeUndefined();
    expect(verificationCodeService.issue).not.toHaveBeenCalled();
  });

  it('lets the cooldown error reach the caller', async () => {
    const issue = vi
      .fn()
      .mockRejectedValue(new RateLimitedError('wait', { retryAfterSeconds: 90 }));
    const { service } = setup({ issue });

    await expect(service.resendVerification({ email: USER.email })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('lets a delivery failure reach the caller', async () => {
    const issue = vi.fn().mockRejectedValue(new EmailDeliveryError('provider down'));
    const { service } = setup({ issue });

    await expect(service.resendVerification({ email: USER.email })).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
  });
});
