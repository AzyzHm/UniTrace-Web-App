// Used by both the Mongoose schema and the Joi validators, so the two cannot disagree about
// what a valid declaration is.
export const DECLARATION_LIMITS = Object.freeze({
  TITLE_MIN: 3,
  TITLE_MAX: 100,
  DESCRIPTION_MIN: 10,
  DESCRIPTION_MAX: 1000,
  LOCATION_MIN: 2,
  LOCATION_MAX: 150,
  PRIVATE_INFO_MAX: 500,
  ATTRIBUTE_VALUE_MAX: 100,
});
