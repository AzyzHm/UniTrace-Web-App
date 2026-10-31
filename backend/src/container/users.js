import { createAccountDeletionService } from '../services/users/account-deletion.service.js';
import { createPasswordChangeService } from '../services/users/password-change.service.js';
import { createProfileService } from '../services/users/profile.service.js';

export function buildUsers({ common, auth }) {
  const { logger, clock, eventBus, userRepository } = common;
  // These come from the auth domain because changing a password or deleting an account must also
  // revoke the refresh tokens (and, for a deletion, drop the pending codes).
  const {
    passwordHasher,
    refreshTokenRepository,
    refreshTokenHasher,
    verificationCodeRepository,
    verificationCodeService,
  } = auth;

  const services = {
    profileService: createProfileService({ userRepository, verificationCodeService, logger }),
    passwordChangeService: createPasswordChangeService({
      userRepository,
      passwordHasher,
      refreshTokenRepository,
      refreshTokenHasher,
      clock,
    }),
    accountDeletionService: createAccountDeletionService({
      userRepository,
      passwordHasher,
      refreshTokenRepository,
      verificationCodeRepository,
      eventBus,
      clock,
      logger,
    }),
  };

  return { services };
}
