import { DECLARATION_STATUSES as S } from '../declarations/declaration-status.js';
import { DECLARATION_TYPES } from '../declarations/declaration-types.js';

export const DECLARATION_TYPE = Object.freeze({
  LOST: DECLARATION_TYPES.LOST,
  FOUND: DECLARATION_TYPES.FOUND,
});

// Open declarations take part in matching. EXPIRED stays in so a late find (case 5) can match.
// MATCHED is excluded on purpose: that declaration is already taken.
export const MATCHABLE_STATUSES = Object.freeze([S.PENDING, S.EXPIRED]);

// A declaration in one of these statuses leaves matching and its open matches are closed.
export const OUT_OF_MATCHING_STATUSES = Object.freeze([S.HIDDEN, S.DELETED]);

// Status an owner gives to their own declaration when the object is recovered.
export const RESOLVED_STATUS = S.RESOLVED;

// Fields that change what matching sees ('status' is added in the service: a restored
// declaration must be matched again).
export const MATCH_FIELDS = Object.freeze([
  'title',
  'description',
  'location',
  'date',
  'picture',
  'category',
  'attributes',
]);
