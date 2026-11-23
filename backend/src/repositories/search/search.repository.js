/**
 * FICHIER : repositories/search/search.repository.js
 *
 * RÔLE
 *   "Magasinier" de la recherche : il exécute les requêtes MongoDB et rien d'autre. Il ne
 *   décide d'aucune règle (statuts autorisés, droits...) : tout cela est dans le service.
 *   Six opérations : compter, lire une page, lire UNE déclaration par son id, lister les lieux
 *   les plus utilisés, idem pour les couleurs, et la recherche avec facettes ($facet).
 *
 * UTILISÉ PAR
 *   - services/search/search.service.js
 *   - container/search.js (le crée)
 *
 * UTILISE
 *   - models/declarations/declaration.model.js (le modèle Mongoose Declaration)
 *   - constants/search/search-options.js (DEFAULT_SEARCH_STATUSES)
 */
import { DEFAULT_SEARCH_STATUSES } from '../../constants/search/search-options.js';
import { Declaration } from '../../models/declarations/declaration.model.js';

// Champs qui ne sortent JAMAIS de MongoDB lors d'une recherche.
const EXCLUDED_FIELDS = Object.freeze({ privateInfo: 0, owner: 0, statusBeforeHidden: 0 });

// Une déclaration "active" : non supprimée et pending/matched.
const ACTIVE_FILTER = Object.freeze({
  deletedAt: null,
  status: { $in: DEFAULT_SEARCH_STATUSES },
});

export function createSearchRepository({ model = Declaration } = {}) {
  // Les valeurs les plus utilisées d'un champ texte libre.
  const topValues = async (field, limit) => {
    const rows = await model.aggregate([
      { $match: { ...ACTIVE_FILTER, [field]: { $type: 'string', $ne: '' } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ]);
    return rows.map((row) => row._id);
  };

  // Construit le tri et la projection communs à findPage et searchWithFacets.
  function buildSortAndProjection({ sortField, direction, byRelevance }) {
    const projection = { ...EXCLUDED_FIELDS };
    let sort;

    if (byRelevance) {
      projection.score = { $meta: 'textScore' };
      sort = { score: { $meta: 'textScore' }, date: -1, _id: -1 };
    } else {
      sort = { [sortField]: direction, _id: direction };
    }

    return { projection, sort };
  }

  return {
    // Nombre total de résultats pour un filtre.
    count(filter) {
      return model.countDocuments(filter);
    },

    // Une page de résultats.
    findPage(filter, { sortField, direction, skip, limit, byRelevance = false }) {
      const { projection, sort } = buildSortAndProjection({ sortField, direction, byRelevance });
      return model.find(filter, projection).sort(sort).skip(skip).limit(limit).lean();
    },

    // Recherche avec facettes : une SEULE requête MongoDB ($facet).
    async searchWithFacets(
      filter,
      { sortField, direction, skip, limit, byRelevance = false, facets = [] },
    ) {
      const { sort } = buildSortAndProjection({ sortField, direction, byRelevance });

      const facetPipeline = {
        metadata: [{ $count: 'total' }],
        data: [{ $sort: sort }, { $skip: skip }, { $limit: limit }],
      };
      for (const facetName of facets) {
        facetPipeline[facetName] = [
          { $group: { _id: `$${facetName}`, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
        ];
      }

      const [result] = await model.aggregate([
        { $match: filter },
        { $facet: facetPipeline },
      ]);

      // Post-traitement : on retire les champs sensibles que $facet n'a pas exclus.
      const items = (result?.data ?? []).map((doc) => {
        const clean = { ...doc };
        delete clean.privateInfo;
        delete clean.owner;
        delete clean.statusBeforeHidden;
        delete clean.__v;
        return clean;
      });

      return {
        total: result?.metadata?.[0]?.total ?? 0,
        items,
        facets: Object.fromEntries(
          facets.map((name) => [name, result?.[name] ?? []]),
        ),
      };
    },

    // Une seule déclaration par son id.
    findById(id) {
      return model.findById(id, { ...EXCLUDED_FIELDS }).lean();
    },

    // Listes pour les menus déroulantes.
    topLocations(limit) {
      return topValues('location', limit);
    },

    topColors(limit) {
      return topValues('attributes.color', limit);
    },
  };
}