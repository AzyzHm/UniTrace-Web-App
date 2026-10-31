import { REFRESH_TOKEN_TTL_MS } from '../../constants/auth/refresh-token.js';
import {
  EmailNotVerifiedError,
  ForbiddenError,
  UnauthenticatedError,
} from '../../exceptions/app-error.js';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_SESSION = 'Invalid or expired session';
// Compared against when the email is unknown, so an unknown email costs the same bcrypt
// time as a wrong password and the response time does not reveal which accounts exist.
const DUMMY_PASSWORD = 'unitrace-dummy-password';

const silentLogger = { warn() {} };

export function createSessionService({
  userRepository,
  passwordHasher,
  tokenService,
  refreshTokenRepository,
  refreshTokenHasher,
  clock = () => new Date(),
  logger = silentLogger,
}) {
  if (!refreshTokenRepository || !refreshTokenHasher) {
    throw new Error(
      'createSessionService(): refreshTokenRepository and refreshTokenHasher are required',
    );
  }

  let dummyHash;
  const getDummyHash = () => {
    dummyHash ??= passwordHasher.hash(DUMMY_PASSWORD);
    return dummyHash;
  };

  async function issueRefreshToken(userId) {
    const token = refreshTokenHasher.generate();
    await refreshTokenRepository.create({
      userId,
      tokenHash: refreshTokenHasher.hash(token),
      expiresAt: new Date(clock().getTime() + REFRESH_TOKEN_TTL_MS),
    });
    return token;
  }

  // An already used token coming back means it was copied: end every session of the user.
  async function revokeAllAndRefuse(userId) {
    await refreshTokenRepository.deleteAllForUser(userId);
    logger.warn({ userId: String(userId) }, 'Refresh token reuse detected, sessions revoked');
    throw new UnauthenticatedError(INVALID_SESSION);
  }

  return {
    async login({ email, password }) {
      const user = await userRepository.findByEmailWithPassword(email);

      const hash = user ? user.password : await getDummyHash();
      const passwordMatches = await passwordHasher.compare(password, hash);
      if (!user || !passwordMatches) throw new UnauthenticatedError(INVALID_CREDENTIALS);

      // Checked after the password, so verification and suspension are not revealed
      // to someone who does not know it.
      if (!user.isEmailVerified) throw new EmailNotVerifiedError();
      if (!user.isActive) throw new ForbiddenError('Your account is suspended');

      return {
        user,
        accessToken: tokenService.signAccessToken(user),
        refreshToken: await issueRefreshToken(user._id),
      };
    },

    async refresh(rawToken) {
      if (typeof rawToken !== 'string' || rawToken === '') {
        throw new UnauthenticatedError(INVALID_SESSION);
      }

      const tokenHash = refreshTokenHasher.hash(rawToken);
      const now = clock();

      const stored = await refreshTokenRepository.findByHash(tokenHash);
      if (!stored) throw new UnauthenticatedError(INVALID_SESSION);

      if (stored.usedAt) return revokeAllAndRefuse(stored.user);
      if (stored.expiresAt.getTime() <= now.getTime()) {
        throw new UnauthenticatedError(INVALID_SESSION);
      }

      const user = await userRepository.findById(stored.user);
      if (!user || user.deletedAt) throw new UnauthenticatedError(INVALID_SESSION);
      if (!user.isActive) throw new ForbiddenError('Your account is suspended');

      // claim is atomic (it only matches an unused token): if two requests send the same
      // token at once, only one wins and the other is treated as a reuse.
      const claimed = await refreshTokenRepository.claim({ tokenHash, now });
      if (!claimed) return revokeAllAndRefuse(stored.user);

      return {
        user,
        accessToken: tokenService.signAccessToken(user),
        refreshToken: await issueRefreshToken(user._id),
      };
    },

    async logout(rawToken) {
      if (typeof rawToken !== 'string' || rawToken === '') return;
      await refreshTokenRepository.deleteByHash(refreshTokenHasher.hash(rawToken));
    },
  };
}
