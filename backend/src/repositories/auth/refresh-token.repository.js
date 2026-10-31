import { RefreshToken } from '../../models/auth/refresh-token.model.js';

export function createRefreshTokenRepository({ model = RefreshToken } = {}) {
  return {
    create({ userId, tokenHash, expiresAt }) {
      return model.create({ user: userId, tokenHash, expiresAt });
    },

    // Separate from claim so the service can tell a reused token (usedAt set) from an unknown one.
    findByHash(tokenHash) {
      return model.findOne({ tokenHash });
    },

    // One atomic update: of two concurrent refreshes with the same token only one can switch
    // usedAt from null, the other gets null and the service treats it as a reuse. Expired
    // tokens do not match either.
    claim({ tokenHash, now }) {
      return model.findOneAndUpdate(
        { tokenHash, usedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
        { returnDocument: 'after' },
      );
    },

    async deleteByHash(tokenHash) {
      const result = await model.deleteOne({ tokenHash });
      return result.deletedCount > 0;
    },

    async deleteAllForUser(userId) {
      await model.deleteMany({ user: userId });
    },
  };
}
