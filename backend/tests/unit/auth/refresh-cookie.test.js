import { describe, expect, it, vi } from 'vitest';
import { REFRESH_TOKEN_TTL_MS } from '../../../src/constants/auth/refresh-token.js';
import { createRefreshCookie } from '../../../src/utils/auth/refresh-cookie.js';

describe('refresh cookie', () => {
  it('sets an httpOnly, strict, path-scoped cookie that lasts 30 days', () => {
    const res = { cookie: vi.fn() };

    createRefreshCookie().set(res, 'the-token');

    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'the-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  });

  it('is HTTPS only when asked, which is what production does', () => {
    const res = { cookie: vi.fn() };

    createRefreshCookie({ secure: true }).set(res, 'the-token');

    expect(res.cookie.mock.calls[0][2].secure).toBe(true);
  });

  it('clears the cookie with the same path and flags it was set with', () => {
    const res = { clearCookie: vi.fn() };

    createRefreshCookie().clear(res);

    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  });

  it('reads the cookie from the request, and gives undefined when there is none', () => {
    const cookie = createRefreshCookie();

    expect(cookie.read({ cookies: { refreshToken: 'abc' } })).toBe('abc');
    expect(cookie.read({ cookies: {} })).toBeUndefined();
    expect(cookie.read({})).toBeUndefined();
  });
});
