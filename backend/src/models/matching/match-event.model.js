import mongoose from 'mongoose';
import { MATCH_EVENT_TYPE_VALUES } from '../../constants/matching/correspondence.js';

const matchEventSchema = new mongoose.Schema(
  {
    correspondence: { type: mongoose.Schema.Types.ObjectId, ref: 'Correspondence', required: true },
    type: { type: String, required: true, enum: MATCH_EVENT_TYPE_VALUES },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

matchEventSchema.index({ correspondence: 1, createdAt: 1 });

export const MatchEvent = mongoose.model('MatchEvent', matchEventSchema);