import { validate } from '../common/validate.js';

// Reçoit le schéma et renvoie le vrai middleware Express (req, res, next).
export function validateSavedSearch(schema) {
  return validate(schema, 'body');
}
