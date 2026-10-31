// The long session lives in the refresh token (stored hashed on the server, so it can be
// revoked). The access token stays short.
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE_NAME = 'refreshToken';
// The browser only sends the cookie to the auth routes (refresh, logout), never with ordinary
// API calls, which reduces how often it travels.
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
