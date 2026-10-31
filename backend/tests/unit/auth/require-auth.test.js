import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthenticatedError } from '../../../src/exceptions/app-error.js';
import { createRequireAuth } from '../../../src/middlewares/auth/require-auth.js';

const USER = { _id: 'u1', isActive: true, deletedAt: null };

function setup({ user = USER, verifyAccessToken } = {}) {
  const tokenService = {
    verifyAccessToken: verifyAccessToken ?? vi.fn().mockReturnValue({ userId: 'u1' }),
  };
  const userRepository = { findById: vi.fn().mockResolvedValue(user) };
  const requireAuth = createRequireAuth({ tokenService, userRepository });

  const run = async (authorization) => {
    const req = {
      get: (name) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
    };
    const next = vi.fn();
    await requireAuth(req, {}, next);
    return { req, next };
  };

  return { run, tokenService, userRepository };
}

describe('requireAuth', () => {
  it('puts the user on the request and moves on', async () => {
    const { run, tokenService, userRepository } = setup();

    const { req, next } = await run('Bearer good.token.here');

    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('good.token.here');
    expect(userRepository.findById).toHaveBeenCalledWith('u1');
    expect(req.user).toBe(USER);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('accepts the scheme in any case', async () => {
    const { run } = setup();

    const { req } = await run('bearer good.token.here');

    expect(req.user).toBe(USER);
  });

  it('refuses a request with no Authorization header, and checks no token', async () => {
    const { run, tokenService } = setup();

    await expect(run(undefined)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each(['Token abc', 'Bearer', 'Bearer a b', 'abc'])(
    'refuses the header "%s"',
    async (header) => {
      const { run } = setup();

      await expect(run(header)).rejects.toBeInstanceOf(UnauthenticatedError);
    },
  );

  it('refuses an invalid token, and loads no user', async () => {
    const verifyAccessToken = vi.fn(() => {
      throw new UnauthenticatedError('Invalid or expired token');
    });
    const { run, userRepository } = setup({ verifyAccessToken });

    await expect(run('Bearer bad.token.here')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it('refuses a token whose user no longer exists', async () => {
    const { run } = setup({ user: null });

    await expect(run('Bearer good.token.here')).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses a token whose user was deleted', async () => {
    const { run } = setup({ user: { ...USER, deletedAt: new Date() } });

    await expect(run('Bearer good.token.here')).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses a suspended user with a 403, not a 401', async () => {
    const { run } = setup({ user: { ...USER, isActive: false } });

    await expect(run('Bearer good.token.here')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
