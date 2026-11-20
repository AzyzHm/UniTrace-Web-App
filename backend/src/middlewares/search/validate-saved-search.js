/**
 * FICHIER : middlewares/search/validate-saved-search.js
 *
 * RÔLE
 *   Contrôle d'entrée de POST /search/saved : applique le schéma Joi au CORPS de la requête et
 *   répond 400 VALIDATION_ERROR (avec la liste des champs fautifs) si quelque chose ne va pas.
 *   Si tout est bon, req.body est remplacé par la version nettoyée (texte sans espaces autour,
 *   dates converties, dateTo avancé à la fin de la journée).
 *
 *   Contrairement à la recherche (qui répond INVALID_QUERY), ici on réutilise le validate() du
 *   projet : c'est un corps JSON classique, donc le code d'erreur standard VALIDATION_ERROR.
 *
 * UTILISÉ PAR
 *   - routes/search/search.routes.js (sur POST /search/saved)
 *
 * UTILISE
 *   - middlewares/common/validate.js (le validate() générique du projet)
 *   - le schéma reçu en paramètre (validators/search/saved-search.validator.js)
 */
import { validate } from '../common/validate.js';

// Reçoit le schéma et renvoie le vrai middleware Express (req, res, next).
export function validateSavedSearch(schema) {
  return validate(schema, 'body');
}
