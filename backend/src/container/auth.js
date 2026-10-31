import { createRequireAuth } from '../middlewares/auth/require-auth.js';
import { createRefreshTokenRepository } from '../repositories/auth/refresh-token.repository.js';
import { createVerificationCodeRepository } from '../repositories/auth/verification-code.repository.js';
import { createAuthService } from '../services/auth/auth.service.js';
import { createCodeHasher } from '../services/auth/code-hasher.js';
import { createPasswordHasher } from '../services/auth/password-hasher.js';
import { createPasswordResetService } from '../services/auth/password-reset.service.js';
import { createRefreshTokenHasher } from '../services/auth/refresh-token-hasher.js';
import { createSessionService } from '../services/auth/session.service.js';
import { createTokenService } from '../services/auth/token.service.js';
import { createVerificationCodeService } from '../services/auth/verification-code.service.js';

export function buildAuth({ config, common, use }) {
  const { logger, clock, emailService, userRepository } = common;

  const passwordHasher = use('passwordHasher', () => createPasswordHasher());
  const refreshTokenRepository = use('refreshTokenRepository', createRefreshTokenRepository);
  const refreshTokenHasher = createRefreshTokenHasher();
  const verificationCodeRepository = use(
    'verificationCodeRepository',
    createVerificationCodeRepository,
  );

  const tokenService = createTokenService({
    secret: config.jwt.accessSecret,
    expiresIn: config.jwt.accessExpires,
    clock,
  });

  const verificationCodeService = createVerificationCodeService({
    codeRepository: verificationCodeRepository,
    codeHasher: createCodeHasher({ secret: config.codeHashSecret }),
    emailService,
    clock,
  });

  const services = {
    authService: createAuthService({
      userRepository,
      passwordHasher,
      verificationCodeService,
      logger,
    }),
    sessionService: createSessionService({
      userRepository,
      passwordHasher,
      tokenService,
      refreshTokenRepository,
      refreshTokenHasher,
      clock,
      logger,
    }),
    passwordResetService: createPasswordResetService({
      userRepository,
      passwordHasher,
      verificationCodeService,
      refreshTokenRepository,
    }),
  };

  // The hashers and repositories are returned too: the users domain reuses them to revoke
  // sessions and clear codes (see users.js).
  return {
    services,
    requireAuth: createRequireAuth({ tokenService, userRepository }),
    tokenService,
    passwordHasher,
    refreshTokenRepository,
    refreshTokenHasher,
    verificationCodeRepository,
    verificationCodeService,
  };
}
