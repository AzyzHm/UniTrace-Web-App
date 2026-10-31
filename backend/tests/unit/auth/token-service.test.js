import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { UnauthenticatedError } from '../../../src/exceptions/app-error.js';
import { createTokenService } from '../../../src/services/auth/token.service.js';

const SECRET = 's'.repeat(32);
const USER = { _id: '507f1f77bcf86cd799439011' };

function setup() {
  // The service reads time from the injected clock, so tests move it with advance() and never wait.
  let now = Date.now();
  const service = createTokenService({
    secret: SECRET,
    expiresIn: '15m',
    clock: () => new Date(now),
  });

  return {
    service,
    advance: (ms) => {
      now += ms;
    },
  };
}

describe('token service', () => {
  it('gives back the user id of a token it signed', () => {
    const { service } = setup();

    const token = service.signAccessToken(USER);

    expect(service.verifyAccessToken(token)).toEqual({ userId: USER._id });
  });

  it('puts only the subject, timestamps and issuer in the token, no role', () => {
    const { service } = setup();

    // No role in the token: requireAuth loads the user on every request, so a role change or a
    // suspension applies at once.
    const payload = jwt.decode(service.signAccessToken(USER));

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'sub']);
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  it('accepts the token just before it expires and refuses it after', () => {
    const { service, advance } = setup();
    const token = service.signAccessToken(USER);

    advance(15 * 60_000 - 1000);
    expect(service.verifyAccessToken(token)).toEqual({ userId: USER._id });

    advance(2000);
    expect(() => service.verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it('refuses a token signed with another secret', () => {
    const { service } = setup();
    const forged = jwt.sign({ sub: USER._id }, 'x'.repeat(32), {
      expiresIn: '15m',
      issuer: 'unitrace',
    });

    expect(() => service.verifyAccessToken(forged)).toThrow(UnauthenticatedError);
  });

  it('refuses a token whose payload was edited after signing', () => {
    const { service } = setup();
    const [header, payload, signature] = service.signAccessToken(USER).split('.');
    const edited = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: 'someone-else' }),
    ).toString('base64url');

    expect(() => service.verifyAccessToken(`${header}.${edited}.${signature}`)).toThrow(
      UnauthenticatedError,
    );
  });

  // verify() pins HS256 and the issuer, which blocks the unsigned and algorithm-swap tokens below.
  it('refuses an unsigned token (alg none)', () => {
    const { service } = setup();
    const unsigned = jwt.sign({ sub: USER._id }, '', { algorithm: 'none', issuer: 'unitrace' });

    expect(() => service.verifyAccessToken(unsigned)).toThrow(UnauthenticatedError);
  });

  it('refuses another algorithm, even with the right secret', () => {
    const { service } = setup();
    const token = jwt.sign({ sub: USER._id }, SECRET, {
      algorithm: 'HS512',
      expiresIn: '15m',
      issuer: 'unitrace',
    });

    expect(() => service.verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it('refuses a token from another issuer', () => {
    const { service } = setup();
    const token = jwt.sign({ sub: USER._id }, SECRET, { expiresIn: '15m', issuer: 'other-app' });

    expect(() => service.verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it('refuses a token with no subject', () => {
    const { service } = setup();
    const token = jwt.sign({}, SECRET, { expiresIn: '15m', issuer: 'unitrace' });

    expect(() => service.verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it.each(['', 'abc', 'a.b.c'])('refuses the garbage token "%s"', (token) => {
    const { service } = setup();

    expect(() => service.verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it('refuses to start without a secret or a lifetime', () => {
    expect(() => createTokenService({ expiresIn: '15m' })).toThrow(/secret/);
    expect(() => createTokenService({ secret: SECRET })).toThrow(/expiresIn/);
  });
});
