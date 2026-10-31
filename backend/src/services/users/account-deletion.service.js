import { EVENTS } from '../../constants/common/events.js';
import { UnauthenticatedError, ValidationError } from '../../exceptions/app-error.js';

const silentLogger = { error() {} };

export function createAccountDeletionService({
  userRepository,
  passwordHasher,
  refreshTokenRepository,
  verificationCodeRepository,
  eventBus,
  clock = () => new Date(),
  logger = silentLogger,
}) {
  const dependencies = {
    userRepository,
    passwordHasher,
    refreshTokenRepository,
    verificationCodeRepository,
    eventBus,
  };
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency) {
      throw new Error(`createAccountDeletionService(): ${name} is required`);
    }
  }

  // Runs after the account is anonymized, so a failure is logged instead of failing a
  // deletion that already happened. allSettled lets both cleanups run.
  async function removeLeftovers(userId) {
    const results = await Promise.allSettled([
      refreshTokenRepository.deleteAllForUser(userId),
      verificationCodeRepository.deleteAllForUser(userId),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(
          { err: result.reason, userId: String(userId) },
          'Cleanup after account deletion failed',
        );
      }
    }
  }

  return {
    async deleteAccount(user, { password }) {
      const stored = await userRepository.findByIdWithPassword(user._id);
      if (!stored) throw new UnauthenticatedError('Invalid or expired token');

      const matches = await passwordHasher.compare(password, stored.password);
      if (!matches) {
        throw new ValidationError('Invalid input', [
          { field: 'password', message: 'Password is incorrect' },
        ]);
      }

      // The placeholders keep the unique username and email indexes satisfied. The .invalid
      // domain is reserved, so the address can never receive mail.
      const id = String(user._id);
      const deletedAt = clock();
      const anonymized = await userRepository.anonymize(user._id, {
        username: `deleted_user_${id}`,
        email: `deleted_${id}@deleted.invalid`,
        deletedAt,
      });
      // anonymize only matches accounts not yet deleted: null means a parallel deletion won.
      if (!anonymized) throw new UnauthenticatedError('Invalid or expired token');

      // The bus logs handler failures instead of throwing them, so the deletion still succeeds.
      await eventBus.emit(EVENTS.USER_DELETED, { userId: id, deletedAt });

      await removeLeftovers(user._id);
    },
  };
}
