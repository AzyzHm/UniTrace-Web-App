/**
 * FICHIER : presenters/search/search-facets.presenter.js
 *
 * RÔLE
 *   Transforme les facettes brutes (résultat MongoDB $facet) en réponse lisible :
 *   [{ key, label, count }] trié par count décroissant, avec libellés français.
 *
 * UTILISÉ PAR
 *   - controllers/search/search.controller.js
 *
 * UTILISE
 *   - constants/search/filter-labels.js (CATEGORY_LABELS, STATUS_LABELS, TYPE_LABELS)
 *   - constants/search/facets-options.js (MAX_FACET_VALUES)
 */
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
} from '../../constants/search/filter-labels.js';
import { MAX_FACET_VALUES } from '../../constants/search/facets-options.js';

// Dictionnaire de libellés par facette. `null` = pas de libellé (renvoyer la clé brute).
const LABELS_BY_FACET = Object.freeze({
  category: CATEGORY_LABELS,
  type: TYPE_LABELS,
  status: STATUS_LABELS,
});

// Transforme [{ _id: 'wallet_bag', count: 12 }, ...] en
// [{ key: 'wallet_bag', label: 'Portefeuille / sac', count: 12 }, ...]
function toFacetResponse(rows, labels) {
  return (rows ?? []).slice(0, MAX_FACET_VALUES).map((row) => ({
    key: row._id,
    label: labels?.[row._id] ?? row._id,
    count: row.count,
  }));
}

// Prend l'objet brut du $facet et renvoie { category: [...], type: [...], status: [...] }
export function toFacetsResponse(rawFacets = {}) {
  return Object.fromEntries(
    Object.entries(rawFacets).map(([facetName, rows]) => [
      facetName,
      toFacetResponse(rows, LABELS_BY_FACET[facetName]),
    ]),
  );
}
