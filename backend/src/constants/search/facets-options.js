/**
 * FICHIER : constants/search/facets-options.js
 *
 * RÔLE
 *   Réglages des facettes de recherche (compteurs par catégorie/type/statut renvoyés avec
 *   les résultats). Écrits UNE seule fois.
 *
 * UTILISÉ PAR
 *   - validators/search/search.validator.js (valeurs autorisées pour ?facets=)
 *   - services/search/search.service.js (limite le nombre de facettes)
 *   - presenters/search/search-facets.presenter.js (libellés)
 */

// Les facettes qu'on peut demander. Volontairement limitées : category, type, status.
// (Pas location/color : trop de valeurs, la liste déroulante suffit.)
export const FACET_KEYS = Object.freeze({
  CATEGORY: 'category',
  TYPE: 'type',
  STATUS: 'status',
});

export const FACET_VALUES = Object.freeze(Object.values(FACET_KEYS));

// Nombre max de valeurs renvoyées par facette (ex. top 20 catégories).
export const MAX_FACET_VALUES = 20;

// Nombre max de facettes demandables en une requête (évite l'abus).
export const MAX_FACETS_PER_REQUEST = 3;
