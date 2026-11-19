/**
 * FICHIER : constants/search/search-options.js
 *
 * RÔLE
 *   Tous les réglages de la recherche, écrits UNE seule fois : statuts par défaut, statuts
 *   réservés aux admins, tris autorisés, longueurs du texte, tailles des listes, durée du cache.
 *   Évite les "nombres magiques" éparpillés dans le code.
 *
 * UTILISÉ PAR
 *   - validators/search/search.validator.js  (tris autorisés, longueur max de q)
 *   - services/search/search.service.js      (statuts, tris, longueur min de q, cache)
 *   - repositories/search/search.repository.js (statuts "actifs")
 *
 * UTILISE
 *   - constants/declarations/declaration-status.js (les noms des statuts)
 */
import { DECLARATION_STATUSES as STATUS } from '../declarations/declaration-status.js';

// Sans filtre "status", on ne cherche que les déclarations actives.
export const DEFAULT_SEARCH_STATUSES = Object.freeze([STATUS.PENDING, STATUS.MATCHED]);

// Réservés aux admins. Pour les autres c'est une erreur 400 (STATUS_FORBIDDEN), pas un retrait
// silencieux : le client comprend que sa demande est refusée.
export const ADMIN_ONLY_STATUSES = Object.freeze([STATUS.HIDDEN, STATUS.DELETED]);

// Statuts proposés dans la liste déroulante à un utilisateur non-admin.
export const PUBLIC_STATUSES = Object.freeze([
  STATUS.PENDING,
  STATUS.MATCHED,
  STATUS.RESOLVED,
  STATUS.EXPIRED,
]);

// Les 5 tris possibles. "relevance" (pertinence) n'a de sens qu'avec un texte de recherche.
export const SEARCH_SORTS = Object.freeze({
  DATE_DESC: 'date_desc',
  DATE_ASC: 'date_asc',
  CREATED_AT_DESC: 'createdAt_desc',
  CREATED_AT_ASC: 'createdAt_asc',
  RELEVANCE: 'relevance',
});

// Liste des valeurs (pratique pour Joi : .valid(...SEARCH_SORT_VALUES)).
export const SEARCH_SORT_VALUES = Object.freeze(Object.values(SEARCH_SORTS));
// Tri appliqué si le client n'en demande pas : date de l'événement, du plus récent au plus ancien.
export const DEFAULT_SEARCH_SORT = SEARCH_SORTS.DATE_DESC;

// Un texte plus court que ça est ignoré (pas d'erreur). Plus long que le max : erreur 400.
export const MIN_TEXT_QUERY_LENGTH = 2;
export const MAX_TEXT_QUERY_LENGTH = 200;

// Lieux et couleurs sont du texte libre saisi par les utilisateurs : on ne propose dans les
// listes déroulantes que les valeurs les plus utilisées, pour ne pas renvoyer des milliers de lignes.
export const MAX_LOCATION_OPTIONS = 100;
export const MAX_COLOR_OPTIONS = 30;

// Durée de vie du cache des listes de filtres : 5 minutes (en millisecondes).
export const FILTERS_CACHE_TTL_MS = 5 * 60 * 1000;
