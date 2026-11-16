import { describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../../../src/middlewares/admin/require-admin.js';
import { ForbiddenError } from '../../../src/exceptions/app-error.js';

describe('requireAdmin', () => {
  const run = (user) => {
    const next = vi.fn();
    const req = { user };
    const call = () => requireAdmin(req, {}, next);
    return { call, next };
  };

  it('lets an admin through', () => {
    const { call, next } = run({ role: 'admin' });

    call();

    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses a regular user with a 403 and does not call next', () => {
    const { call, next } = run({ role: 'user' });

    expect(call).toThrow(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });

  it('the 403 has the FORBIDDEN code', () => {
    const { call } = run({ role: 'user' });

    try {
      call();
    } catch (err) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    }
  });

  it('refuses a request where no user was loaded', () => {
    const { call, next } = run(undefined);

    expect(call).toThrow(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });
});
