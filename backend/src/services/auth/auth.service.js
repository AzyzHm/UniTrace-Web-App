import { CODE_PURPOSES } from '../../constants/auth/code-purposes.js';
import { InvalidCodeError } from '../../exceptions/app-error.js';
import { EmailDeliveryError } from '../common/email.service.js';

const silentLogger = { warn() {} };

export function createAuthService({
  userRepository,
  passwordHasher,
  verificationCodeService,
  logger = silentLogger,
}) {
  if (!verificationCodeService) {
    throw new Error('createAuthService(): verificationCodeService is required');
  }

  return {
    async register({ username, email, phone, password }) {
      const hashedPassword = await passwordHasher.hash(password);

      const user = await userRepository.create({
        username,
        email,
        phone,
        password: hashedPassword,
      });

      // The account already exists, so a failed email must not fail the registration:
      // the user can ask for a new code with resendVerification.
      try {
        await verificationCodeService.issue({
          userId: user._id,
          email: user.email,
          purpose: CODE_PURPOSES.EMAIL_VERIFICATION,
        });
      } catch (err) {
        if (!(err instanceof EmailDeliveryError)) throw err;
        logger.warn({ err, userId: String(user._id) }, 'Verification email could not be sent');
      }

      return user;
    },

    async verifyEmail({ email, code }) {
      const user = await userRepository.findByEmail(email);
      // Same error as a wrong code, so the answer does not reveal which emails are registered.
      if (!user) throw new InvalidCodeError();

      await verificationCodeService.verify({
        userId: user._id,
        purpose: CODE_PURPOSES.EMAIL_VERIFICATION,
        code,
      });

      // markEmailVerified only matches unverified users: null means already verified.
      const verified = await userRepository.markEmailVerified(user._id);
      if (!verified) throw new InvalidCodeError();
      return verified;
    },

    async resendVerification({ email }) {
      const user = await userRepository.findByEmail(email);
      // Silent for unknown or already verified emails, for the same reason as verifyEmail.
      if (!user || user.isEmailVerified) return;

      await verificationCodeService.issue({
        userId: user._id,
        email: user.email,
        purpose: CODE_PURPOSES.EMAIL_VERIFICATION,
      });
    },
  };
}
