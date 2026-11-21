import { SavedSearch } from '../../models/search/saved-search.model.js';

// `model` est injectable (par défaut le vrai modèle) : en test on peut donner un faux modèle.
export function createSavedSearchRepository({ model = SavedSearch } = {}) {
  return {
    // Crée une alerte et la renvoie.
    create({ owner, name, criteria }) {
      return model.create({ owner, name, criteria });
    },

    // Mes alertes, la plus récente d'abord. lean() : objets simples, plus rapides.
    listByOwner(owner) {
      return model.find({ owner }).sort({ createdAt: -1, _id: -1 }).lean();
    },

    // Combien d'alertes j'ai déjà (pour appliquer la limite).
    countByOwner(owner) {
      return model.countDocuments({ owner });
    },

    // Supprime UNE alerte, mais seulement si elle m'appartient. Renvoie true si quelque chose a
    // été supprimé : "n'existe pas" et "appartient à un autre" donnent la même réponse (false).
    async deleteByIdAndOwner(id, owner) {
      const result = await model.deleteOne({ _id: id, owner });
      return result.deletedCount > 0;
    },

    // Supprime toutes les alertes d'un utilisateur (appelé quand son compte est supprimé).
    async deleteAllByOwner(owner) {
      const result = await model.deleteMany({ owner });
      return result.deletedCount;
    },
  };
}
