import { DEFAULT_SEARCH_STATUSES } from '../../constants/search/search-options.js';
import { Declaration } from '../../models/declarations/declaration.model.js';

// Champs qui ne sortent JAMAIS de MongoDB lors d'une recherche. privateInfo est déjà caché par
// le schéma (select:false), mais on l'exclut aussi ici : si le schéma ou le presenter changeait
// par erreur un jour, ces champs resteraient protégés (deux verrous valent mieux qu'un).
const EXCLUDED_FIELDS = Object.freeze({ privateInfo: 0, owner: 0, statusBeforeHidden: 0 });

// Une déclaration "active" : non supprimée et pending/matched. Sert aux listes de lieux/couleurs :
// on ne propose que des valeurs qui existent sur des déclarations visibles.
const ACTIVE_FILTER = Object.freeze({
  deletedAt: null,
  status: { $in: DEFAULT_SEARCH_STATUSES },
});

// `model` est injectable (par défaut le vrai modèle) : en test on peut donner un faux modèle.
export function createSearchRepository({ model = Declaration } = {}) {
  // Les valeurs les plus utilisées d'un champ texte libre (ex. les lieux).
  // Pipeline d'agrégation en 4 étapes. Exemple de résultat : Bibliothèque (40), Amphi A (25).
  const topValues = async (field, limit) => {
    const rows = await model.aggregate([
      // 1) garder les déclarations actives qui ont une valeur non vide pour ce champ
      { $match: { ...ACTIVE_FILTER, [field]: { $type: 'string', $ne: '' } } },
      // 2) regrouper par valeur et compter combien de fois elle apparaît
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      // 3) trier du plus fréquent au moins fréquent (à égalité : ordre alphabétique)
      { $sort: { count: -1, _id: 1 } },
      // 4) ne garder que les N premières (sinon la liste déroulante pourrait avoir des milliers de lignes)
      { $limit: limit },
    ]);
    return rows.map((row) => row._id);
  };

  return {
    // Nombre total de résultats pour un filtre : sert à calculer totalPages, hasNext, hasPrev.
    count(filter) {
      return model.countDocuments(filter);
    },

    // Une page de résultats.
    //  - filter  : filtre MongoDB construit par search-filter-builder.js
    //  - sortField / direction : champ de tri et sens (1 = croissant, -1 = décroissant)
    //  - skip / limit : combien sauter et combien prendre (pagination)
    //  - byRelevance : trier par score de pertinence du texte
    findPage(filter, { sortField, direction, skip, limit, byRelevance = false }) {
      const projection = { ...EXCLUDED_FIELDS };
      let sort;

      if (byRelevance) {
        // Pour trier sur le score, MongoDB doit d'abord le "projeter" (le calculer et le garder).
        projection.score = { $meta: 'textScore' };
        // À score égal, le plus récent d'abord.
        sort = { score: { $meta: 'textScore' }, date: -1, _id: -1 };
      } else {
        // _id sert de départage : sans lui, deux déclarations de même date pourraient changer de
        // place entre la page 1 et la page 2 (doublons ou oublis).
        sort = { [sortField]: direction, _id: direction };
      }

      // lean() : renvoie des objets JavaScript simples (plus rapide), qui vont directement au presenter.
      return model.find(filter, projection).sort(sort).skip(skip).limit(limit).lean();
    },

    // Une seule déclaration par son id (GET /search/:id). Mêmes champs exclus que pour la liste :
    // jamais privateInfo, owner ni statusBeforeHidden. Renvoie null si l'id n'existe pas.
    // Le repository ne regarde PAS le statut : décider qui a le droit de voir une déclaration
    // supprimée ou cachée est une règle métier, elle est dans le service.
    findById(id) {
      return model.findById(id, { ...EXCLUDED_FIELDS }).lean();
    },

    // Listes pour les menus déroulantes (limitées par le service).
    topLocations(limit) {
      return topValues('location', limit);
    },

    topColors(limit) {
      return topValues('attributes.color', limit);
    },
  };
}
