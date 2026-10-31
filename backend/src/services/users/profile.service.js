import { CODE_PURPOSES } from '../../constants/auth/code-purposes.js';
import { RateLimitedError, UnauthenticatedError } from '../../exceptions/app-error.js';
import { EmailDeliveryError } from '../common/email.service.js';

const EDITABLE_FIELDS = ['username', 'email', 'phone'];

const silentLogger = { warn() {} };

export const VERIFICATION = Object.freeze({
  NOT_NEEDED: 'not_needed',
  SENT: 'sent',
  NOT_SENT: 'not_sent',
});

export function createProfileService({
  userRepository,
  verificationCodeService,
  logger = silentLogger,
}) {
  if (!userRepository || !verificationCodeService) {
    throw new Error(
      'createProfileService(): userRepository and verificationCodeService are required',
    );
  }

  async function sendVerificationCode(user) {
    try {
      await verificationCodeService.issue({
        userId: user._id,
        email: user.email,
        purpose: CODE_PURPOSES.EMAIL_VERIFICATION,
      });
      return VERIFICATION.SENT;
    } catch (err) {
      // The email is already saved: a cooldown or a delivery failure must not fail the
      // update. NOT_SENT tells the client to offer a resend.
      if (!(err instanceof RateLimitedError) && !(err instanceof EmailDeliveryError)) throw err;
      logger.warn({ err, userId: String(user._id) }, 'Verification email could not be sent');
      return VERIFICATION.NOT_SENT;
    }
  }

  return {
    async updateProfile(user, input) {
      // Only real changes are kept: sending the same email again must not reset the
      // verification or send a new code.
      const changes = {};
      for (const field of EDITABLE_FIELDS) {
        if (input[field] !== undefined && input[field] !== user[field]) {
          changes[field] = input[field];
        }
      }

      if (Object.keys(changes).length === 0) {
        return { user, verification: VERIFICATION.NOT_NEEDED };
      }

      const emailChanged = changes.email !== undefined;
      // A new address has not proven it belongs to the user yet.
      if (emailChanged) changes.isEmailVerified = false;

      const updated = await userRepository.updateProfile(user._id, changes);
      if (!updated) throw new UnauthenticatedError('Invalid or expired token');
      if (!emailChanged) return { user: updated, verification: VERIFICATION.NOT_NEEDED };

      return {
        user: updated,
        verification: await sendVerificationCode(updated),
      };
    },
  };
}
