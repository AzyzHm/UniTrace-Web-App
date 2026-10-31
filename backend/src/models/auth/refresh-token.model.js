import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Only the hash is stored, so a database leak does not hand out usable sessions.
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    // Set when the token is exchanged. A used token that comes back is a replay: session.service
    // then revokes every token of the user (reuse detection).
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Every refresh looks the token up by its hash.
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });

// For deleteAllForUser: logout everywhere, password change and reset, account deletion.
refreshTokenSchema.index({ user: 1 });

// MongoDB deletes the document at expiresAt by itself. Its cleanup job only runs about once a
// minute, so the services still check expiresAt on their own.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
