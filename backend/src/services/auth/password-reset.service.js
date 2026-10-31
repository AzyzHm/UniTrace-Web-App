import { CODE_PURPOSES } from '../../constants/auth/code-purposes.js';
import { InvalidCodeError } from '../../exceptions/app-error.js';

// Deleted and suspended accounts cannot reset. Callers answer exactly as for an unknown
// email, so the endpoints do not reveal whether an account exists.
function canResetPassword(user) {
  return Boolean(user) && !user.deletedAt && user.isActive;
}

export function createPasswordResetService({
  userRepository,
  passwordHasher,
  verificationCodeService,
  refreshTokenRepository,
}) {
  const dependencies = {
    userRepository,
    passwordHasher,
    verificationCodeService,
    refreshTokenRepository,
  };
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency) {
      throw new Error(`createPasswordResetService(): ${name} is required`);
    }
  }

  return {
    async requestReset({ email }) {
      const user = await userRepository.findByEmail(email);
      if (!canResetPassword(user)) return;

      await verificationCodeService.issue({
        userId: user._id,
        email: user.email,
        purpose: CODE_PURPOSES.PASSWORD_RESET,
      });
    },

    async resetPassword({ email, code, newPassword }) {
      const user = await userRepository.findByEmail(email);
      if (!canResetPassword(user)) throw new InvalidCodeError();

      await verificationCodeService.verify({
        userId: user._id,
        purpose: CODE_PURPOSES.PASSWORD_RESET,
        code,
      });

      const passwordHash = await passwordHasher.hash(newPassword);
      const updated = await userRepository.updatePassword(user._id, passwordHash);
      if (!updated) throw new InvalidCodeError();

      // Whoever knew the old password may still be signed in: end every session.
      await refreshTokenRepository.deleteAllForUser(user._id);
    },
  };
}
