import mongoose from 'mongoose';
import { ROLES, ROLE_VALUES } from '../../constants/common/roles.js';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    // Hidden by default: only login, password change and account deletion ask for it.
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ROLE_VALUES,
      default: ROLES.USER,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    // Set when the account is anonymized. requireAuth refuses such accounts.
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // Safety net, since controllers go through the presenters: a user serialized directly still
    // never carries the password hash.
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Uniqueness is enforced by the index and not by a check before the insert, so two simultaneous
// signups cannot both succeed. The repository turns the duplicate key error into a 409.
userSchema.index({ email: 1 }, { unique: true });

// Case-insensitive (strength 2), so Sara and sara are the same name. The email needs no collation
// because the schema already lowercases it.
userSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const User = mongoose.model('User', userSchema);
