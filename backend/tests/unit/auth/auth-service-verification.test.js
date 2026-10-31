import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../src/exceptions/app-error.js';
import { createAuthService } from '../../../src/services/auth/auth.service.js';
import { EmailDeliveryError } from '../../../src/services/common/email.service.js';

const INPUT = { username: 'sara.k', email: 'sara@isamm.uma.tn', password: 'Secret123' };
const CREATED = { _id: '507f1f77bcf86cd799439011', email: 'sara@isamm.uma.tn' };

function setup({ create, issue } = {}) {
  const userRepository = { create: create ?? vi.fn().mockResolvedValue(CREATED) };
  const passwordHasher = { hash: vi.fn().mockResolvedValue('hashed') };
  const verificationCodeService = { issue: issue ?? vi.fn().mockResolvedValue(undefined) };
  const logger = { warn: vi.fn() };
  const service = createAuthService({
    userRepository,
    passwordHasher,
    verificationCodeService,
    logger,
  });

  return { service, userRepository, verificationCodeService, logger };
}

describe('auth service, verification code on register', () => {
  it('issues an email verification code for the new user', async () => {
    const { service, verificationCodeService } = setup();

    await service.register(INPUT);

    expect(verificationCodeService.issue).toHaveBeenCalledWith({
      userId: CREATED._id,
      email: CREATED.email,
      purpose: 'email_verification',
    });
  });

  it('returns the created user', async () => {
    const { service } = setup();

    expect(await service.register(INPUT)).toBe(CREATED);
  });

  it('issues no code when the account is refused', async () => {
    const create = vi.fn().mockRejectedValue(new ConflictError('Account already exists'));
    const { service, verificationCodeService } = setup({ create });

    await expect(service.register(INPUT)).rejects.toBeInstanceOf(ConflictError);
    expect(verificationCodeService.issue).not.toHaveBeenCalled();
  });

  it('still returns the user, and logs, when the email cannot be delivered', async () => {
    const issue = vi.fn().mockRejectedValue(new EmailDeliveryError('provider down'));
    const { service, logger } = setup({ issue });

    expect(await service.register(INPUT)).toBe(CREATED);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('does not hide any other failure', async () => {
    const issue = vi.fn().mockRejectedValue(new Error('database down'));
    const { service } = setup({ issue });

    await expect(service.register(INPUT)).rejects.toThrow('database down');
  });

  it('refuses to start without a verification code service', () => {
    expect(() => createAuthService({ userRepository: {}, passwordHasher: {} })).toThrow(
      /verificationCodeService/,
    );
  });
});
