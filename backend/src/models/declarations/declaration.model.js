import mongoose from 'mongoose';
import { CATEGORY_KEYS } from '../../constants/declarations/categories.js';
import { DECLARATION_LIMITS as LIMITS } from '../../constants/declarations/declaration-limits.js';
import {
  DECLARATION_STATUS_VALUES,
  DEFAULT_DECLARATION_STATUS,
} from '../../constants/declarations/declaration-status.js';
import { DECLARATION_TYPE_VALUES } from '../../constants/declarations/declaration-types.js';

const declarationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: LIMITS.TITLE_MIN,
      maxlength: LIMITS.TITLE_MAX,
    },
    type: {
      type: String,
      required: true,
      enum: DECLARATION_TYPE_VALUES,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: LIMITS.DESCRIPTION_MIN,
      maxlength: LIMITS.DESCRIPTION_MAX,
    },
    // The server-generated filename, not a URL. The presenter builds the URL of the picture route.
    picture: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: DECLARATION_STATUS_VALUES,
      default: DEFAULT_DECLARATION_STATUS,
    },
    // Remembered when a declaration is hidden, so it can only be restored to where it was.
    statusBeforeHidden: {
      type: String,
      enum: [...DECLARATION_STATUS_VALUES, null],
      default: null,
    },
    date: {
      type: Date,
      required: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
      minlength: LIMITS.LOCATION_MIN,
      maxlength: LIMITS.LOCATION_MAX,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: CATEGORY_KEYS,
    },
    // A Map because the keys depend on the category (brand, color, ...). Values are short strings.
    attributes: {
      type: Map,
      of: { type: String, trim: true, maxlength: LIMITS.ATTRIBUTE_VALUE_MAX },
      default: () => ({}),
    },
    // Excluded from every query unless it is asked for with +privateInfo, so a forgotten filter
    // elsewhere cannot leak it. The repository only asks for it in the owner views.
    privateInfo: {
      type: String,
      trim: true,
      maxlength: LIMITS.PRIVATE_INFO_MAX,
      default: null,
      select: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // Safety net, since controllers go through the presenters. If a document is ever serialized
    // directly, the attributes Map would otherwise come out as {}.
    toJSON: {
      flattenMaps: true,
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Prepared for search by type, category and status, newest date first. No current route uses it
// (only /mine exists), it is there for the search work.
declarationSchema.index({ type: 1, category: 1, status: 1, date: -1 });

// Serves findPageByOwner: the owner filter and the sort on createdAt.
declarationSchema.index({ owner: 1, createdAt: -1 });

export const Declaration = mongoose.model('Declaration', declarationSchema);
