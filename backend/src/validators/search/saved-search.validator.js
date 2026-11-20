/**
 * FICHIER : validators/search/saved-search.validator.js
 *
 * RÔLE
 *   Le "règlement" du corps de POST /search/saved : quels critères on peut sauvegarder et avec
 *   quelles valeurs. C'est un schéma Joi.
 *
 *   Différences avec la query de recherche (search.validator.js) :
 *     - pas de status, sort, page, limit : ils décrivent l'affichage, pas ce qu'on surveille ;
 *     - AU MOINS UN critère est obligatoire (sinon l'alerte se déclencherait pour TOUTE nouvelle
 *       déclaration, ce qui n'a aucun sens) ;
 *     - q doit faire au moins 2 caractères : la recherche ignore un texte plus court, une alerte
 *       sur un texte ignoré ne surveillerait rien. Ici on refuse clairement (400) ;
 *     - un champ inconnu est refusé (le middleware validate() interdit les champs en trop).
 *
 * UTILISÉ PAR
 *   - routes/index.js (passe le schéma aux routes)
 *   - middlewares/search/validate-saved-search.js (l'exécute)
 *
 * UTILISE
 *   - validators/search/search.validator.js (searchCriteriaFields : mêmes règles que la recherche)
 *   - constants/search/saved-search-options.js, constants/search/search-options.js
 */
import Joi from 'joi';
import {
  SAVED_SEARCH_CRITERIA,
  SAVED_SEARCH_NAME_MAX,
} from '../../constants/search/saved-search-options.js';
import {
  MAX_TEXT_QUERY_LENGTH,
  MIN_TEXT_QUERY_LENGTH,
} from '../../constants/search/search-options.js';
import { DATE_RANGE_MESSAGES, searchCriteriaFields } from './search.validator.js';

export const savedSearchSchema = Joi.object({
  // Étiquette facultative pour retrouver l'alerte dans la liste.
  name: Joi.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX),

  // Les critères viennent de la recherche (mêmes règles), sauf q qui devient plus strict.
  ...searchCriteriaFields,
  q: Joi.string().trim().min(MIN_TEXT_QUERY_LENGTH).max(MAX_TEXT_QUERY_LENGTH),
})
  // Au moins un critère parmi la liste (hasPhoto:false compte : "sans photo" est un vrai choix).
  .or(...SAVED_SEARCH_CRITERIA)
  .messages({
    ...DATE_RANGE_MESSAGES,
    'object.missing': `at least one search criterion is required (${SAVED_SEARCH_CRITERIA.join(', ')})`,
  });
