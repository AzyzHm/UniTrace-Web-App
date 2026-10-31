export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  // Upper bound so one request can never ask for a whole collection.
  MAX_LIMIT: 50,
});
