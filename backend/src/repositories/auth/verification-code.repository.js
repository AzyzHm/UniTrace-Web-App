import { VerificationCode } from '../../models/auth/verification-code.model.js';

// MongoDB's duplicate key error code.
const DUPLICATE_KEY = 11000;

export function createVerificationCodeRepository({ model = VerificationCode } = {}) {
  return {
    // The resend cooldown is enforced inside the query. The filter only matches an existing code
    // sent before the cooldown. If the cooldown has not passed, nothing matches, the upsert tries
    // to insert a second document for the same user and purpose and the unique index refuses it.
    // That error becomes null, which the service reports as a 429. A read followed by a write
    // would let two simultaneous requests both send an email.
    async replaceCode({ userId, purpose, codeHash, expiresAt, sentAt, cooldownMs }) {
      const sentBefore = new Date(sentAt.getTime() - cooldownMs);

      try {
        return await model.findOneAndUpdate(
          { user: userId, purpose, lastSentAt: { $lte: sentBefore } },
          { $set: { codeHash, expiresAt, attempts: 0, lastSentAt: sentAt } },
          { upsert: true, returnDocument: 'after' },
        );
      } catch (err) {
        if (err.code === DUPLICATE_KEY) return null;
        throw err;
      }
    },

    findByUserAndPurpose({ userId, purpose }) {
      return model.findOne({ user: userId, purpose });
    },

    // The limit and the increment are one atomic update, so parallel guesses cannot go past
    // maxAttempts. Null means no code or no attempts left, and both give the same error.
    consumeAttempt({ userId, purpose, maxAttempts }) {
      return model.findOneAndUpdate(
        { user: userId, purpose, attempts: { $lt: maxAttempts } },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
    },

    // The boolean lets verify() notice that a parallel request already consumed the code.
    async delete({ userId, purpose }) {
      const result = await model.deleteOne({ user: userId, purpose });
      return result.deletedCount > 0;
    },

    async deleteAllForUser(userId) {
      await model.deleteMany({ user: userId });
    },
  };
}
