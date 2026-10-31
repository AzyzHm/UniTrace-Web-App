import { toUserResponse } from '../../presenters/users/user.presenter.js';
import { VERIFICATION } from '../../services/users/profile.service.js';

// Only an email change needs a message: the user must know that a code was (or was not) sent to
// the new address.
const MESSAGES = Object.freeze({
  [VERIFICATION.SENT]:
    'Your email address was changed. Enter the code sent to the new address to verify it.',
  [VERIFICATION.NOT_SENT]:
    'Your email address was changed, but the verification code could not be sent. Request a new code in a moment.',
});

const PASSWORD_CHANGED_MESSAGE =
  'Your password has been changed. Your other devices were logged out.';

export function createUserController({
  profileService,
  passwordChangeService,
  accountDeletionService,
  refreshCookie,
}) {
  // A missing dependency stops the app at startup, not at the first request that needs it.
  const dependencies = {
    profileService,
    passwordChangeService,
    accountDeletionService,
    refreshCookie,
  };
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency) {
      throw new Error(`createUserController(): ${name} is required`);
    }
  }

  return {
    me(req, res) {
      res.status(200).json({ user: toUserResponse(req.user) });
    },

    async updateMe(req, res) {
      const { user, verification } = await profileService.updateProfile(req.user, req.body);

      const body = { user: toUserResponse(user) };
      if (MESSAGES[verification]) body.message = MESSAGES[verification];

      res.status(200).json(body);
    },

    async changePassword(req, res) {
      const { refreshToken } = await passwordChangeService.changePassword(req.user, req.body);
      // The other devices were logged out, so this one receives a fresh refresh token and the user
      // stays connected here.
      refreshCookie.set(res, refreshToken);
      res.set('Cache-Control', 'no-store');
      res.status(200).json({ message: PASSWORD_CHANGED_MESSAGE });
    },

    async deleteMe(req, res) {
      await accountDeletionService.deleteAccount(req.user, req.body);
      refreshCookie.clear(res);
      res.status(204).end();
    },
  };
}
