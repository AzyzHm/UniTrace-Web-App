import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_MS,
} from '../../constants/auth/refresh-token.js';

export function createRefreshCookie({ secure = false } = {}) {
  // httpOnly: page scripts cannot read the token, so an XSS cannot steal it.
  // sameSite strict: never sent on cross-site requests. path: only sent to the auth routes.
  // clearCookie needs the same path and flags as set, or the browser keeps the cookie.
  const base = {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };

  return {
    read: (req) => req.cookies?.[REFRESH_COOKIE_NAME],
    set: (res, token) =>
      res.cookie(REFRESH_COOKIE_NAME, token, { ...base, maxAge: REFRESH_TOKEN_TTL_MS }),
    clear: (res) => res.clearCookie(REFRESH_COOKIE_NAME, base),
  };
}
