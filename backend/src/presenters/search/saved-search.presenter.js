/**
 * FICHIER : presenters/search/saved-search.presenter.js
 *
 * RÔLE
 *   Décide ce qu'une recherche sauvegardée montre au client. Une seule vue : id, nom, critères,
 *   dates. Le propriétaire (`owner`) et les champs internes (__v) ne sortent jamais.
 *   Les critères vides (null / absents) sont retirés, pour que le client ne voie que ce qui a
 *   réellement été choisi.
 *
 * UTILISÉ PAR
 *   - controllers/search/search.controller.js
 */

// Garde uniquement les critères qui ont une valeur. `false` est une vraie valeur (hasPhoto=false
// veut dire "sans photo") : on teste donc null/undefined, pas "est faux".
function toCompactCriteria(criteria = {}) {
  return Object.fromEntries(
    Object.entries(criteria).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function toSavedSearchResponse(savedSearch) {
  return {
    // Un document Mongoose a le virtuel `id` ; un résultat lean() n'a que `_id`.
    id: savedSearch.id ?? String(savedSearch._id),
    name: savedSearch.name ?? null,
    // toObject() : un sous-document Mongoose devient un objet simple avant d'être filtré.
    criteria: toCompactCriteria(savedSearch.criteria?.toObject?.() ?? savedSearch.criteria),
    createdAt: savedSearch.createdAt,
  };
}
