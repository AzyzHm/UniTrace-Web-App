import { describe, expect, it, vi } from 'vitest';
import { REFRESH_TOKEN_TTL_MS } from '../../../src/constants/auth/refresh-token.js';
import {
  EmailNotVerifiedError,
  ForbiddenError,
  UnauthenticatedError,
} from '../../../src/exceptions/app-error.js';
import { createSessionService } from '../../../src/services/auth/session.service.js';

const NOW = new Date('2026-10-18T10:00:00.000Z');
const USER = {
  _id: '507f1f77bcf86cd799439011',
  email: 'sara@isamm.uma.tn',
  password: 'stored-hash',
  isEmailVerified: true,
  isActive: true,
  deletedAt: null,
};
const INPUT = { email: USER.email, password: 'Secret123' };
const STORED = { user: USER._id, usedAt: null, expiresAt: new Date(NOW.getTime() + 60_000) };

function setup({ user = USER, passwordMatches = true, stored = STORED, claimed = {} } = {}) {
  const userRepository = {
    findByEmailWithPassword: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
  };
  const passwordHasher = {
    hash: vi.fn().mockResolvedValue('dummy-hash'),
    compare: vi.fn().mockResolvedValue(passwordMatches),
  };
  const tokenService = { signAccessToken: vi.fn().mockReturnValue('signed.jwt.token') };
  const refreshTokenRepository = {
    create: vi.fn().mockResolvedValue({}),
    findByHash: vi.fn().mockResolvedValue(stored),
    claim: vi.fn().mockResolvedValue(claimed),
    deleteByHash: vi.fn().mockResolvedValue(true),
    deleteAllForUser: vi.fn().mockResolvedValue(undefined),
  };
  const refreshTokenHasher = {
    generate: vi.fn().mockReturnValue('new-refresh-token'),
    hash: vi.fn((token) => `hash:${token}`),
  };
  const logger = { warn: vi.fn() };
  const service = createSessionService({
    userRepository,
    passwordHasher,
    tokenService,
    refreshTokenRepository,
    refreshTokenHasher,
    clock: () => NOW,
    logger,
  });

  return {
    service,
    userRepository,
    passwordHasher,
    tokenService,
    refreshTokenRepository,
    refreshTokenHasher,
    logger,
  };
}

describe('session service, creation', () => {
  it('refuses to start without the refresh token dependencies', () => {
    expect(() =>
      createSessionService({ userRepository: {}, passwordHasher: {}, tokenService: {} }),
    ).toThrow(/refreshTokenRepository/);
  });
});

describe('session service, login', () => {
  it('returns the user, an access token and a refresh token', async () => {
    const { service, userRepository, passwordHasher, tokenService } = setup();

    const result = await service.login(INPUT);

    expect(userRepository.findByEmailWithPassword).toHaveBeenCalledWith(INPUT.email);
    expect(passwordHasher.compare).toHaveBeenCalledWith('Secret123', 'stored-hash');
    expect(tokenService.signAccessToken).toHaveBeenCalledWith(USER);
    expect(result).toEqual({
      user: USER,
      accessToken: 'signed.jwt.token',
      refreshToken: 'new-refresh-token',
    });
  });

  it('stores only the hash of the refresh token, with a 30 day expiry', async () => {
    const { service, refreshTokenRepository } = setup();

    await service.login(INPUT);

    expect(refreshTokenRepository.create).toHaveBeenCalledWith({
      userId: USER._id,
      tokenHash: 'hash:new-refresh-token',
      expiresAt: new Date(NOW.getTime() + REFRESH_TOKEN_TTL_MS),
    });
  });

  it('refuses a wrong password with a generic message and issues nothing', async () => {
    const { service, tokenService, refreshTokenRepository } = setup({ passwordMatches: false });

    const error = await service.login(INPUT).catch((e) => e);

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error.message).toBe('Invalid email or password');
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown email with the same error, even if the comparison says yes', async () => {
    const { service, tokenService } = setup({ user: null, passwordMatches: true });

    const error = await service.login(INPUT).catch((e) => e);

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error.message).toBe('Invalid email or password');
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  // An unknown email still pays for one password comparison, so login takes a similar time
  // whether or not the account exists.
  it('still runs one comparison for an unknown email, against a dummy hash', async () => {
    const { service, passwordHasher } = setup({ user: null });

    await service.login(INPUT).catch(() => {});

    expect(passwordHasher.compare).toHaveBeenCalledTimes(1);
    expect(passwordHasher.compare).toHaveBeenCalledWith('Secret123', 'dummy-hash');
  });

  it('builds the dummy hash only once', async () => {
    const { service, passwordHasher } = setup({ user: null });

    await service.login(INPUT).catch(() => {});
    await service.login(INPUT).catch(() => {});

    expect(passwordHasher.hash).toHaveBeenCalledTimes(1);
  });

  // Unverified and suspended are reported only after the password matches, so they cannot be used
  // to find out which emails are registered.
  it('refuses an unverified account when the password is right', async () => {
    const { service, tokenService, refreshTokenRepository } = setup({
      user: { ...USER, isEmailVerified: false },
    });

    await expect(service.login(INPUT)).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('does not reveal an unverified account when the password is wrong', async () => {
    const { service } = setup({
      user: { ...USER, isEmailVerified: false },
      passwordMatches: false,
    });

    await expect(service.login(INPUT)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses a suspended account when the password is right', async () => {
    const { service, tokenService, refreshTokenRepository } = setup({
      user: { ...USER, isActive: false },
    });

    await expect(service.login(INPUT)).rejects.toBeInstanceOf(ForbiddenError);
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('does not reveal a suspended account when the password is wrong', async () => {
    const { service } = setup({ user: { ...USER, isActive: false }, passwordMatches: false });

    await expect(service.login(INPUT)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('session service, refresh', () => {
  it('uses the presented token up and returns a new access token and a new refresh token', async () => {
    const { service, tokenService, refreshTokenRepository } = setup();

    const result = await service.refresh('old-refresh-token');

    expect(refreshTokenRepository.findByHash).toHaveBeenCalledWith('hash:old-refresh-token');
    expect(refreshTokenRepository.claim).toHaveBeenCalledWith({
      tokenHash: 'hash:old-refresh-token',
      now: NOW,
    });
    expect(tokenService.signAccessToken).toHaveBeenCalledWith(USER);
    expect(refreshTokenRepository.create).toHaveBeenCalledWith({
      userId: USER._id,
      tokenHash: 'hash:new-refresh-token',
      expiresAt: new Date(NOW.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    expect(result).toEqual({
      user: USER,
      accessToken: 'signed.jwt.token',
      refreshToken: 'new-refresh-token',
    });
  });

  it.each([undefined, null, '', 123, {}])(
    'refuses the missing or malformed token %j',
    async (token) => {
      const { service, refreshTokenRepository } = setup();

      await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(refreshTokenRepository.findByHash).not.toHaveBeenCalled();
    },
  );

  it('refuses an unknown token and revokes nothing', async () => {
    const { service, refreshTokenRepository } = setup({ stored: null });

    await expect(service.refresh('whatever')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
    expect(refreshTokenRepository.claim).not.toHaveBeenCalled();
  });

  // Refresh tokens are single use: presenting a used one suggests it was copied, so every session
  // of that user is ended.
  it('treats an already used token as theft, and ends every session of that user', async () => {
    const used = { ...STORED, usedAt: new Date(NOW.getTime() - 1000) };
    const { service, refreshTokenRepository, logger } = setup({ stored: used });

    await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthenticatedError);

    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith(USER._id);
    expect(refreshTokenRepository.claim).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired token without revoking anything', async () => {
    const expired = { ...STORED, expiresAt: new Date(NOW.getTime() - 1) };
    const { service, refreshTokenRepository } = setup({ stored: expired });

    await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
    expect(refreshTokenRepository.claim).not.toHaveBeenCalled();
  });

  // claim() returns nothing when another request used the token first, which is handled like reuse.
  it('treats losing the race for the token as reuse, and issues nothing', async () => {
    const { service, refreshTokenRepository } = setup({ claimed: null });

    await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthenticatedError);

    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith(USER._id);
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  // The user checks run before claim(), so these refusals leave the token unused.
  it('refuses a token whose user no longer exists, without using the token up', async () => {
    const { service, refreshTokenRepository } = setup({ user: null });

    await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(refreshTokenRepository.claim).not.toHaveBeenCalled();
  });

  it('refuses a token whose user was deleted, without using the token up', async () => {
    const { service, refreshTokenRepository } = setup({
      user: { ...USER, deletedAt: new Date() },
    });

    await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(refreshTokenRepository.claim).not.toHaveBeenCalled();
  });

  it('refuses a suspended user with a 403, without using the token up', async () => {
    const { service, refreshTokenRepository } = setup({ user: { ...USER, isActive: false } });

    await expect(service.refresh('old')).rejects.toBeInstanceOf(ForbiddenError);
    expect(refreshTokenRepository.claim).not.toHaveBeenCalled();
  });
});

describe('session service, logout', () => {
  it('deletes the presented token, and only that one', async () => {
    const { service, refreshTokenRepository } = setup();

    await service.logout('my-token');

    expect(refreshTokenRepository.deleteByHash).toHaveBeenCalledWith('hash:my-token');
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });

  it('does nothing, and does not fail, when there is no token', async () => {
    const { service, refreshTokenRepository } = setup();

    await expect(service.logout(undefined)).resolves.toBeUndefined();
    await expect(service.logout('')).resolves.toBeUndefined();
    expect(refreshTokenRepository.deleteByHash).not.toHaveBeenCalled();
  });
});
