import { Router } from 'express';
import { noLimit } from '../../middlewares/common/rate-limiters.js';
import { validate } from '../../middlewares/common/validate.js';

export function createAuthRoutes({
  authController,
  registerSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  rateLimiters = {},
}) {
  const router = Router();
  // Limiters are optional so the routes can be built without them (noLimit does nothing).
  // authFailures counts only failed requests. loginAccount counts failed logins per IP and email
  // pair. emailSending counts every request, because each one sends an email.
  const { authFailures = noLimit, loginAccount = noLimit, emailSending = noLimit } = rateLimiters;

  router.post('/register', emailSending, validate(registerSchema), authController.register);
  router.post(
    '/verify-email',
    authFailures,
    validate(verifyEmailSchema),
    authController.verifyEmail,
  );
  router.post(
    '/resend-verification',
    emailSending,
    validate(resendVerificationSchema),
    authController.resendVerification,
  );
  router.post('/login', authFailures, loginAccount, validate(loginSchema), authController.login);

  // No schema and no limiter: the refresh token comes from the cookie, not from the body.
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);

  router.post(
    '/forgot-password',
    emailSending,
    validate(forgotPasswordSchema),
    authController.forgotPassword,
  );
  router.post(
    '/reset-password',
    authFailures,
    validate(resetPasswordSchema),
    authController.resetPassword,
  );

  return router;
}
