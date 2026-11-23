import Joi from 'joi';
import { PAGINATION } from '../../constants/common/pagination.js';
import { DECLARATION_LIMITS as LIMITS } from '../../constants/declarations/declaration-limits.js';
import { DECLARATION_STATUS_VALUES } from '../../constants/declarations/declaration-status.js';
import { FACET_VALUES, MAX_FACETS_PER_REQUEST } from '../../constants/search/facets-options.js';
import {
  DEFAULT_SEARCH_SORT,
  MAX_TEXT_QUERY_LENGTH,
  SEARCH_SORT_VALUES,
} from '../../constants/search/search-options.js';
import { categoryField, typeField } from '../declarations/declaration-fields.js';

// ---------------------------------------------------------------------------------------------
// statusListField : accepte DEUX écritures et les ramène au même format (un tableau sans doublon)
// ---------------------------------------------------------------------------------------------
function statusListField() {
  return Joi.any().custom((value, helpers) => {
    const parts = (Array.isArray(value) ? value : [value]).flatMap((item) =>
      typeof item === 'string' ? item.split(',') : [item],
    );
    const statuses = parts.map((part) => (typeof part === 'string' ? part.trim() : part));

    const invalid = statuses.find((status) => !DECLARATION_STATUS_VALUES.includes(status));
    if (statuses.length === 0 || invalid !== undefined) {
      return helpers.message(
        `status must be one or more of: ${DECLARATION_STATUS_VALUES.join(', ')}`,
      );
    }
    return [...new Set(statuses)];
  });
}

// ---------------------------------------------------------------------------------------------
// facetsField : même logique que statusListField.
// ---------------------------------------------------------------------------------------------
function facetsField() {
  return Joi.any().custom((value, helpers) => {
    const parts = (Array.isArray(value) ? value : [value]).flatMap((item) =>
      typeof item === 'string' ? item.split(',') : [item],
    );
    const names = parts.map((p) => (typeof p === 'string' ? p.trim() : p)).filter(Boolean);

    const invalid = names.find((name) => !FACET_VALUES.includes(name));
    if (invalid !== undefined) {
      return helpers.message(`facets must be one or more of: ${FACET_VALUES.join(', ')}`);
    }
    const unique = [...new Set(names)];
    if (unique.length > MAX_FACETS_PER_REQUEST) {
      return helpers.message(`at most ${MAX_FACETS_PER_REQUEST} facets can be requested`);
    }
    return unique;
  });
}

// ---------------------------------------------------------------------------------------------
// dateTo : inclure toute la journée
// ---------------------------------------------------------------------------------------------
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1;

function toEndOfDay(value, helpers) {
  return DATE_ONLY.test(String(helpers.original))
    ? new Date(value.getTime() + END_OF_DAY_MS)
    : value;
}

// ---------------------------------------------------------------------------------------------
// Les CRITÈRES
// ---------------------------------------------------------------------------------------------
export const searchCriteriaFields = {
  q: Joi.string().trim().max(MAX_TEXT_QUERY_LENGTH).allow(''),
  type: typeField(),
  category: categoryField(),
  location: Joi.string().trim().min(1).max(LIMITS.LOCATION_MAX),
  color: Joi.string().trim().min(1).max(LIMITS.ATTRIBUTE_VALUE_MAX),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date()
    .iso()
    .when('dateFrom', { is: Joi.exist(), then: Joi.date().min(Joi.ref('dateFrom')) })
    .custom(toEndOfDay),
  hasPhoto: Joi.boolean(),
};

export const DATE_RANGE_MESSAGES = {
  'date.min': '{{#label}} must be greater than or equal to dateFrom',
};

// ---------------------------------------------------------------------------------------------
// Le schéma de la query de recherche
// ---------------------------------------------------------------------------------------------
export const searchQuerySchema = Joi.object({
  ...searchCriteriaFields,

  status: statusListField(),

  sort: Joi.string()
    .valid(...SEARCH_SORT_VALUES)
    .default(DEFAULT_SEARCH_SORT),

  page: Joi.number().integer().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),

  // Facettes demandées (optionnel). Voir facetsField pour la logique.
  facets: facetsField(), // ← C'ÉTAIT ÇA QUI MANQUAIT
}).messages(DATE_RANGE_MESSAGES);
