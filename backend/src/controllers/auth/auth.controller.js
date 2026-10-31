import { UnauthenticatedError } from '../../exceptions/app-error.js';
import { toUserResponse } from '../../presenters/users/user.presenter.js';

// The resend and forgot messages are the same whether or not the address has an account, so the
// API cannot be used to find out which emails are registered.
const RESEND_MESSAGE =
  'If this address belongs to an unverified account, a new code has been sent.';
const FORGOT_MESSAGE = 'If this address belongs to an account, a reset code has been sent.';
const RESET_MESSAGE = 'Your password has been changed. Please log in again.';

export function createAuthController({
  authService,
  sessionService,
  passwordResetService,
  refreshCookie,
}) {
  function sendSession(res, { user, accessToken, refreshToken }) {
    refreshCookie.set(res, refreshToken);
    // The body holds an access token, so it must never be stored by the browser or a proxy.
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ accessToken, user: toUserResponse(user) });
  }

  return {
    // No session is opened here: the email address has to be verified before the first login.
    async register(req, res) {
      const user = await authService.register(req.body);
      res.status(201).json({ user: toUserResponse(user) });
    },

    async verifyEmail(req, res) {
      const user = await authService.verifyEmail(req.body);
      res.status(200).json({ user: toUserResponse(user) });
    },

    async resendVerification(req, res) {
      await authService.resendVerification(req.body);
      res.status(200).json({ message: RESEND_MESSAGE });
    },

    async login(req, res) {
      sendSession(res, await sessionService.login(req.body));
    },

    async refresh(req, res) {
      try {
        sendSession(res, await sessionService.refresh(refreshCookie.read(req)));
      } catch (err) {
        // A refused token is dropped from the browser so it stops sending a cookie that can never
        // work again. Any other error keeps the cookie, since the token may still be valid.
        if (err instanceof UnauthenticatedError) refreshCookie.clear(res);
        throw err;
      }
    },

    async logout(req, res) {
      await sessionService.logout(refreshCookie.read(req));
      refreshCookie.clear(res);
      res.status(204).end();
    },

    async forgotPassword(req, res) {
      await passwordResetService.requestReset(req.body);
      res.status(200).json({ message: FORGOT_MESSAGE });
    },

    async resetPassword(req, res) {
      await passwordResetService.resetPassword(req.body);
      // The reset revokes the user's refresh tokens, so the cookie of this browser is useless now.
      refreshCookie.clear(res);
      res.status(200).json({ message: RESET_MESSAGE });
    },
  };
}
