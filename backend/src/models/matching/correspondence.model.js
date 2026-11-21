import mongoose from 'mongoose';
import {
  CONFIDENCE_VALUES,
  CORRESPONDENCE_STATUS,
  CORRESPONDENCE_STATUS_VALUES,
  DECISION_VALUES,
} from '../../constants/matching/correspondence.js';

const reactionSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: [...DECISION_VALUES, null], default: null },
    comment: { type: String, trim: true, maxlength: 500, default: null },
    at: { type: Date, default: null },
    recoveredAt: { type: Date, default: null }, // when this side confirmed the handover
  },
  { _id: false },
);

const score = { type: Number, min: 0, max: 1 };

const correspondenceSchema = new mongoose.Schema(
  {
    lost: { type: mongoose.Schema.Types.ObjectId, ref: 'Declaration', required: true },
    found: { type: mongoose.Schema.Types.ObjectId, ref: 'Declaration', required: true },

    descriptionScore: score,
    locationScore: { ...score, default: null },
    dateScore: score,
    imageScore: { ...score, default: null }, // null when a picture is missing
    globalScore: score,
    confidence: { type: String, enum: CONFIDENCE_VALUES },
    // Stored so an administrator can understand the match without recomputing anything.
    explanation: { type: String, maxlength: 300 },

    status: {
      type: String,
      enum: CORRESPONDENCE_STATUS_VALUES,
      default: CORRESPONDENCE_STATUS.PROPOSED,
    },
    closedReason: { type: String, default: null },

    reactions: {
      lost: { type: reactionSchema, default: () => ({}) },
      found: { type: reactionSchema, default: () => ({}) },
    },
  },
  { timestamps: true },
);

// One match per pair, enforced by the index so two simultaneous runs cannot create it twice.
correspondenceSchema.index({ lost: 1, found: 1 }, { unique: true });
// The list a user sees: the matches of one declaration, best score first.
correspondenceSchema.index({ lost: 1, status: 1, globalScore: -1 });
correspondenceSchema.index({ found: 1, status: 1, globalScore: -1 });

export const Correspondence = mongoose.model('Correspondence', correspondenceSchema);
