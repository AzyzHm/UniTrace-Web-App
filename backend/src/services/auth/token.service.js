import jwt from 'jsonwebtoken';
import { UnauthenticatedError } from '../../exceptions/app-error.js';

const ALGORITHM = 'HS256';
const ISSUER = 'unitrace';

export function createTokenService({ secret, expiresIn, clock = () => new Date() }) {
  if (!secret) {
    throw new Error('createTokenService(): secret is required');
  }
  if (!expiresIn) {
    throw new Error('createTokenService(): expiresIn is required');
  }

  // jsonwebtoken reads the real clock by default: both calls below use this one
  // so tests control the time.
  const nowSeconds = () => Math.floor(clock().getTime() / 1000);

  return {
    signAccessToken(user) {
      return jwt.sign({ sub: String(user._id), iat: nowSeconds() }, secret, {
        algorithm: ALGORITHM,
        expiresIn,
        issuer: ISSUER,
      });
    },

    verifyAccessToken(token) {
      try {
        // The algorithm is pinned: a token claiming another one (or none) is refused.
        const payload = jwt.verify(token, secret, {
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          clockTimestamp: nowSeconds(),
        });
        if (typeof payload.sub !== 'string' || payload.sub === '') {
          throw new Error('Token has no subject');
        }
        return { userId: payload.sub };
      } catch {
        // One message for every failure: the caller learns nothing about why it was refused.
        throw new UnauthenticatedError('Invalid or expired token');
      }
    },
  };
}
