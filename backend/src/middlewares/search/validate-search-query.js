/**
 * FICHIER : middlewares/search/validate-search-query.js
 *
 * RÔLE
 *   Contrôle d'entrée de la recherche : applique le schéma Joi à la query (?q=...&type=...) et
 *   répond 400 INVALID_QUERY si quelque chose ne va pas.
 *
 * POURQUOI NE PAS RÉUTILISER validate() ?
 *   Le validate() du projet répond toujours VALIDATION_ERROR. Le cahier des charges de la
 *   recherche demande un code propre : INVALID_QUERY. Ce fichier est donc une variante.
 *
 * UTILISÉ PAR
 *   - routes/search/search.routes.js (sur GET /search/declarations)
 *
 * UTILISE
 *   - exceptions/app-error.js (InvalidQueryError)
 *   - le schéma reçu en paramètre (validators/search/search.validator.js)
 */
import { InvalidQueryError } from '../../exceptions/app-error.js';

// Mêmes options que le validate() du projet :
//  - abortEarly:false   -> on liste TOUTES les erreurs d'un coup
//  - allowUnknown:false -> un paramètre inconnu est une erreur (une faute de frappe comme
//                          ?categorie=phone ne doit pas renvoyer silencieusement tout)
//  - convert:true       -> "20" (texte de l'URL) devient le nombre 20
const JOI_OPTIONS = Object.freeze({
  abortEarly: false,
  allowUnknown: false,
  stripUnknown: false,
  convert: true,
  errors: { wrap: { label: false } },
});

// Reçoit le schéma et renvoie le vrai middleware Express (req, res, next).
export function validateSearchQuery(schema) {
  return function validateSearchQueryMiddleware(req, res, next) {
    // Joi rend { value: query nettoyée, error }.
    const { value, error } = schema.validate(req.query ?? {}, JOI_OPTIONS);

    if (error) {
      // Liste lisible { field, message } pour que le front sache quel paramètre corriger.
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      // next(erreur) : l'error-handler du projet la transforme en JSON 400 standard.
      return next(new InvalidQueryError('Invalid search query', details));
    }

    // Express 5 : req.query n'a pas de "setter", donc "req.query = value" planterait.
    // defineProperty remplace la valeur. Le controller reçoit alors la query nettoyée.
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    return next();
  };
}
