import { ConflictError } from '../../exceptions/app-error.js';
import { User } from '../../models/users/user.model.js';

// MongoDB's duplicate key error code.
const DUPLICATE_KEY_CODE = 11000;

// Not a valid bcrypt hash, so no password can ever match it: an anonymized account cannot log in
// even if some code path forgets to check deletedAt.
const LOCKED_PASSWORD = '!';

const DUPLICATE_MESSAGES = {
  email: 'Email is already used',
  username: 'Username is already taken',
};

// keyPattern tells which unique index fired, so the error names the right field (email or
// username) instead of a generic duplicate message.
function toConflictError(err, message) {
  if (err.code !== DUPLICATE_KEY_CODE) return err;

  const field = Object.keys(err.keyPattern ?? {})[0] ?? 'unknown';
  return new ConflictError(message, [
    { field, message: DUPLICATE_MESSAGES[field] ?? 'Value is already used' },
  ]);
}

export function createUserRepository({ model = User } = {}) {
  return {
    async create(data) {
      try {
        return await model.create(data);
      } catch (err) {
        throw toConflictError(err, 'Account already exists');
      }
    },

    findById(id) {
      return model.findById(id);
    },

    findByEmail(email) {
      return model.findOne({ email });
    },

    // The password hash is hidden by default. Only the flows that must compare it ask for it:
    // login, password change and account deletion.
    findByEmailWithPassword(email) {
      return model.findOne({ email }).select('+password');
    },

    findByIdWithPassword(id) {
      return model.findById(id).select('+password');
    },

    // The filter only matches an unverified account, so a second call changes nothing.
    markEmailVerified(id) {
      return model.findOneAndUpdate(
        { _id: id, isEmailVerified: false },
        { $set: { isEmailVerified: true } },
        { returnDocument: 'after' },
      );
    },

    updatePassword(id, passwordHash) {
      return model.findOneAndUpdate(
        { _id: id },
        { $set: { password: passwordHash } },
        { returnDocument: 'after' },
      );
    },

    async updateProfile(id, changes) {
      try {
        return await model.findOneAndUpdate(
          { _id: id },
          { $set: changes },
          // findOneAndUpdate skips schema validation unless asked.
          { returnDocument: 'after', runValidators: true },
        );
      } catch (err) {
        throw toConflictError(err, 'Profile could not be updated');
      }
    },

    // The filter only matches a live account, so a double click or two parallel deletions
    // anonymize once and the loser gets null. The placeholder username and email are unique per
    // user, which also frees the real ones for a new signup.
    anonymize(id, { username, email, deletedAt }) {
      return model.findOneAndUpdate(
        { _id: id, deletedAt: null },
        {
          $set: {
            username,
            email,
            phone: null,
            password: LOCKED_PASSWORD,
            isEmailVerified: false,
            deletedAt,
          },
        },
        // Validators are off on purpose: deleted_user_<id> is 37 characters, over the 30 allowed
        // for a username.
        { returnDocument: 'after', runValidators: false },
      );
    },
  };
}
