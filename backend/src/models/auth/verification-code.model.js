import mongoose from 'mongoose';
import { CODE_PURPOSE_VALUES } from '../../constants/auth/code-purposes.js';

const verificationCodeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  purpose: { type: String, enum: CODE_PURPOSE_VALUES, required: true },
  // The code is short, so only its hash is stored and a leak does not reveal pending codes.
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  // Incremented before the code is compared, so guessing is capped even with parallel requests.
  attempts: { type: Number, default: 0, min: 0 },
  // Drives the resend cooldown.
  lastSentAt: { type: Date, default: Date.now },
});

// One live code per user and purpose. A new code replaces the old one, and the repository relies
// on this unique index to enforce the resend cooldown (see replaceCode).
verificationCodeSchema.index({ user: 1, purpose: 1 }, { unique: true });

// Same as for refresh tokens: automatic cleanup, with the expiry still checked in the service.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationCode = mongoose.model('VerificationCode', verificationCodeSchema);
