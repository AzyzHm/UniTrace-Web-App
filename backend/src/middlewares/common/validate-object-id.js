/**
 * FICHIER : middlewares/common/validate-object-id.js
 *
 * RÔLE
 *   Vérifie qu'un paramètre d'URL (par défaut :id) a la forme d'un identifiant MongoDB : 24
 *   caractères hexadécimaux. Sinon il répond 400 VALIDATION_ERROR tout de suite, sans toucher à
 *   la base. Évite qu'un "id" comme "abc" ou "saved" provoque une erreur de conversion côté
 *   MongoDB (qui deviendrait un 500).
 *
 * UTILISÉ PAR
 *   - routes/search/search.routes.js (sur GET /search/:id et DELETE /search/saved/:id)
 *
 * UTILISE
 *   - middlewares/common/validate.js (le validate() générique du projet)
 */
import Joi from 'joi';
import { validate } from './validate.js';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// Fabrique : validateObjectId() contrôle req.params.id ; validateObjectId('declarationId')
// contrôlerait req.params.declarationId.
export function validateObjectId(paramName = 'id') {
  const message = `${paramName} must be a valid id`;
  const schema = Joi.object({
    [paramName]: Joi.string()
      .pattern(OBJECT_ID_PATTERN)
      .required()
      .messages({
        'string.base': message,
        'string.empty': message,
        'string.pattern.base': message,
        'any.required': `${paramName} is required`,
      }),
  });

  return validate(schema, 'params');
}
