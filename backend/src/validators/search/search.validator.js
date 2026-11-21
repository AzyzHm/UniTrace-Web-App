import Joi from 'joi';
import { PAGINATION } from '../../constants/common/pagination.js';
import { DECLARATION_LIMITS as LIMITS } from '../../constants/declarations/declaration-limits.js';
import { DECLARATION_STATUS_VALUES } from '../../constants/declarations/declaration-status.js';
import {
  DEFAULT_SEARCH_SORT,
  MAX_TEXT_QUERY_LENGTH,
  SEARCH_SORT_VALUES,
} from '../../constants/search/search-options.js';
import { categoryField, typeField } from '../declarations/declaration-fields.js';

// ---------------------------------------------------------------------------------------------
// statusListField : accepte DEUX écritures et les ramène au même format (un tableau sans doublon)
//   ?status=pending,matched         (une liste avec virgules)
//   ?status=pending&status=matched  (un paramètre répété)
// Exemple : "hidden, deleted,hidden" devient ["hidden", "deleted"].
// Un statut inconnu ("archived") fait échouer la validation.
// ---------------------------------------------------------------------------------------------
function statusListField() {
  return Joi.any().custom((value, helpers) => {
    // 1) On met tout dans un tableau, puis on découpe chaque texte sur les virgules.
    const parts = (Array.isArray(value) ? value : [value]).flatMap((item) =>
      typeof item === 'string' ? item.split(',') : [item],
    );
    // 2) On enlève les espaces autour de chaque statut.
    const statuses = parts.map((part) => (typeof part === 'string' ? part.trim() : part));

    // 3) On cherche un statut qui n'existe pas dans la liste officielle.
    const invalid = statuses.find((status) => !DECLARATION_STATUS_VALUES.includes(status));
    if (statuses.length === 0 || invalid !== undefined) {
      return helpers.message(
        `status must be one or more of: ${DECLARATION_STATUS_VALUES.join(', ')}`,
      );
    }
    // 4) new Set(...) retire les doublons.
    return [...new Set(statuses)];
  });
}

// ---------------------------------------------------------------------------------------------
// dateTo : inclure toute la journée
// Problème : "2026-10-31" est lu comme minuit. Une déclaration du 31 à 15 h serait exclue.
// Solution : si l'utilisateur écrit seulement une date (sans heure), on avance à 23:59:59.999.
// S'il écrit une heure précise, on la garde telle quelle.
// ---------------------------------------------------------------------------------------------
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/; // forme "AAAA-MM-JJ" sans heure
const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1; // 23 h 59 min 59,999 s en millisecondes

function toEndOfDay(value, helpers) {
  // helpers.original = le texte tel que l'utilisateur l'a écrit (avant conversion en Date).
  return DATE_ONLY.test(String(helpers.original))
    ? new Date(value.getTime() + END_OF_DAY_MS)
    : value;
}

// ---------------------------------------------------------------------------------------------
// Les CRITÈRES : ce que l'on cherche (texte, type, catégorie, lieu, couleur, dates, photo).
// Exportés à part car la recherche sauvegardée (saved-search.validator.js) en a besoin aussi :
// les deux schémas partagent donc exactement les mêmes règles et ne peuvent pas se contredire.
// ---------------------------------------------------------------------------------------------
export const searchCriteriaFields = {
  // Texte libre. Pas de minimum ici : un q d'un seul caractère n'est pas une erreur, le service
  // l'ignorera. Maximum 200 caractères. Vide autorisé.
  q: Joi.string().trim().max(MAX_TEXT_QUERY_LENGTH).allow(''),

  // Mêmes règles que la création de déclaration.
  type: typeField(),
  category: categoryField(),

  // Lieu et couleur : texte libre, longueurs bornées par les limites du modèle.
  location: Joi.string().trim().min(1).max(LIMITS.LOCATION_MAX),
  color: Joi.string().trim().min(1).max(LIMITS.ATTRIBUTE_VALUE_MAX),

  dateFrom: Joi.date().iso(),
  dateTo: Joi.date()
    .iso()
    // dateTo >= dateFrom, mais seulement si dateFrom est donné ; sinon la référence ferait
    // planter Joi (c'est la raison du .when).
    .when('dateFrom', { is: Joi.exist(), then: Joi.date().min(Joi.ref('dateFrom')) })
    .custom(toEndOfDay),

  // "true" / "false" (texte de l'URL) deviennent de vrais booléens.
  hasPhoto: Joi.boolean(),
};

// Message plus clair quand dateTo est avant dateFrom (partagé par les deux schémas).
export const DATE_RANGE_MESSAGES = {
  'date.min': '{{#label}} must be greater than or equal to dateFrom',
};

// ---------------------------------------------------------------------------------------------
// Le schéma de la query de recherche : les critères + status, tri et pagination.
// Tout est facultatif sauf les défauts (sort, page, limit).
// ---------------------------------------------------------------------------------------------
export const searchQuerySchema = Joi.object({
  ...searchCriteriaFields,

  // Un ou plusieurs statuts (voir statusListField). Le droit d'utiliser hidden/deleted est
  // vérifié plus tard dans le service, car il dépend du rôle.
  status: statusListField(),

  // Tri : une des 5 valeurs autorisées, date_desc par défaut.
  sort: Joi.string()
    .valid(...SEARCH_SORT_VALUES)
    .default(DEFAULT_SEARCH_SORT),

  // Pagination : page >= 1 (défaut 1), limite entre 1 et 50 (défaut 20).
  // ?limit=999 est donc refusé : impossible de demander toute la base d'un coup.
  page: Joi.number().integer().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
}).messages(DATE_RANGE_MESSAGES);
