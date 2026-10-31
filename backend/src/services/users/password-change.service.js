import { REFRESH_TOKEN_TTL_MS } from '../../constants/auth/refresh-token.js';
import { UnauthenticatedError, ValidationError } from '../../exceptions/app-error.js';

export function createPasswordChangeService({
  userRepository,
  passwordHasher,
  refreshTokenRepository,
  refreshTokenHasher,
  clock = () => new Date(),
}) {
  const dependencies = {
    userRepository,
    passwordHasher,
    refreshTokenRepository,
    refreshTokenHasher,
  };
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency) {
      throw new Error(`createPasswordChangeService(): ${name} is required`);
    }
  }

  return {
    async changePassword(user, { currentPassword, newPassword }) {
      const stored = await userRepository.findByIdWithPassword(user._id);
      if (!stored) throw new UnauthenticatedError('Invalid or expired token');

      const matches = await passwordHasher.compare(currentPassword, stored.password);
      if (!matches) {
        throw new ValidationError('Invalid input', [
          { field: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }

      const passwordHash = await passwordHasher.hash(newPassword);
      const updated = await userRepository.updatePassword(user._id, passwordHash);
      if (!updated) throw new UnauthenticatedError('Invalid or expired token');

      // Every session is ended, then one new token is issued so the device that changed
      // the password stays signed in.
      await refreshTokenRepository.deleteAllForUser(user._id);

      const refreshToken = refreshTokenHasher.generate();
      await refreshTokenRepository.create({
        userId: user._id,
        tokenHash: refreshTokenHasher.hash(refreshToken),
        expiresAt: new Date(clock().getTime() + REFRESH_TOKEN_TTL_MS),
      });

      return { refreshToken };
    },
  };
}
