import { describe, expect, it, vi } from 'vitest';
import { RateLimitedError, UnauthenticatedError } from '../../../src/exceptions/app-error.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';
import { createProfileService, VERIFICATION } from '../../../src/services/users/profile.service.js';

const USER = {
  _id: '507f1f77bcf86cd799439011',
  username: 'sara.k',
  email: 'sara@isamm.uma.tn',
  phone: null,
  isEmailVerified: true,
};

function setup({ updateProfile, issue } = {}) {
  const userRepository = {
    updateProfile: updateProfile ?? vi.fn(async (_id, changes) => ({ ...USER, ...changes })),
  };
  const verificationCodeService = { issue: issue ?? vi.fn().mockResolvedValue(undefined) };
  const logger = { warn: vi.fn() };
  const service = createProfileService({ userRepository, verificationCodeService, logger });

  return { service, userRepository, verificationCodeService, logger };
}

describe('profile service', () => {
  it('requires its dependencies', () => {
    expect(() => createProfileService({})).toThrow(/required/);
  });

  describe('a change that does not touch the email', () => {
    it('writes only the fields that changed', async () => {
      const { service, userRepository } = setup();

      const result = await service.updateProfile(USER, {
        username: 'sara.k2',
        phone: '+21655000000',
      });

      expect(userRepository.updateProfile).toHaveBeenCalledWith(USER._id, {
        username: 'sara.k2',
        phone: '+21655000000',
      });
      expect(result.user.username).toBe('sara.k2');
      expect(result.verification).toBe(VERIFICATION.NOT_NEEDED);
    });

    it('keeps the email verified and sends no code', async () => {
      const { service, userRepository, verificationCodeService } = setup();

      await service.updateProfile(USER, { username: 'sara.k2' });

      expect(userRepository.updateProfile.mock.calls[0][1]).not.toHaveProperty('isEmailVerified');
      expect(verificationCodeService.issue).not.toHaveBeenCalled();
    });

    it('can remove the phone number', async () => {
      const { service, userRepository } = setup();

      await service.updateProfile({ ...USER, phone: '+21655000000' }, { phone: null });

      expect(userRepository.updateProfile).toHaveBeenCalledWith(USER._id, { phone: null });
    });

    it('does nothing at all when every value is already the current one', async () => {
      const { service, userRepository, verificationCodeService } = setup();

      const result = await service.updateProfile(USER, {
        username: USER.username,
        email: USER.email,
        phone: null,
      });

      expect(userRepository.updateProfile).not.toHaveBeenCalled();
      expect(verificationCodeService.issue).not.toHaveBeenCalled();
      expect(result.user).toBe(USER);
      expect(result.verification).toBe(VERIFICATION.NOT_NEEDED);
    });

    it('ignores any field that is not editable, even if one slips past validation', async () => {
      const { service, userRepository } = setup();

      await service.updateProfile(USER, { username: 'sara.k2', role: 'admin', isActive: false });

      expect(userRepository.updateProfile).toHaveBeenCalledWith(USER._id, {
        username: 'sara.k2',
      });
    });

    it('answers 401 when the user disappeared since the request was authenticated', async () => {
      const { service } = setup({ updateProfile: vi.fn().mockResolvedValue(null) });

      await expect(service.updateProfile(USER, { username: 'x.y.z' })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });
  });

  describe('a change of email', () => {
    const INPUT = { email: 'sara.new@isamm.uma.tn' };

    it('drops the verified flag in the same write as the new address', async () => {
      const { service, userRepository } = setup();

      await service.updateProfile(USER, INPUT);

      expect(userRepository.updateProfile).toHaveBeenCalledTimes(1);
      expect(userRepository.updateProfile).toHaveBeenCalledWith(USER._id, {
        email: 'sara.new@isamm.uma.tn',
        isEmailVerified: false,
      });
    });

    it('sends a verification code to the NEW address', async () => {
      const { service, verificationCodeService } = setup();

      const result = await service.updateProfile(USER, INPUT);

      expect(verificationCodeService.issue).toHaveBeenCalledWith({
        userId: USER._id,
        email: 'sara.new@isamm.uma.tn',
        purpose: 'email_verification',
      });
      expect(result.verification).toBe(VERIFICATION.SENT);
    });

    it('sends no code when the write fails, for example on a duplicate', async () => {
      const failure = new Error('duplicate');
      const { service, verificationCodeService } = setup({
        updateProfile: vi.fn().mockRejectedValue(failure),
      });

      await expect(service.updateProfile(USER, INPUT)).rejects.toBe(failure);
      expect(verificationCodeService.issue).not.toHaveBeenCalled();
    });

    it.each([
      ['a cooldown', new RateLimitedError('wait', { retryAfterSeconds: 30 })],
      ['a delivery failure', new EmailDeliveryError('down')],
    ])('keeps the change and reports "not sent" after %s', async (_label, failure) => {
      const { service, logger } = setup({ issue: vi.fn().mockRejectedValue(failure) });

      const result = await service.updateProfile(USER, INPUT);

      expect(result.user.email).toBe('sara.new@isamm.uma.tn');
      expect(result.verification).toBe(VERIFICATION.NOT_SENT);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('lets an unexpected error through instead of hiding a real fault', async () => {
      const failure = new Error('database exploded');
      const { service } = setup({ issue: vi.fn().mockRejectedValue(failure) });

      await expect(service.updateProfile(USER, INPUT)).rejects.toBe(failure);
    });

    it('treats a different casing of the same email as no change', async () => {
      const { service, userRepository } = setup();

      await service.updateProfile(USER, { email: USER.email });

      expect(userRepository.updateProfile).not.toHaveBeenCalled();
    });
  });
});
