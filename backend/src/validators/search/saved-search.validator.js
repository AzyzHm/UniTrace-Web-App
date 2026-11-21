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
