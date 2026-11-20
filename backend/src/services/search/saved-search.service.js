/**
 * FICHIER : services/search/saved-search.service.js
 *
 * RÔLE
 *   "Chef de cuisine" des recherches sauvegardées : les RÈGLES MÉTIER sont ici.
 *     - un utilisateur ne peut pas dépasser 20 recherches sauvegardées (409 SAVED_SEARCH_LIMIT) ;
 *     - il ne voit et ne supprime que les SIENNES ;
 *     - l'alerte d'un autre utilisateur répond 404 (jamais 403 : on ne révèle pas qu'elle existe) ;
 *     - quand un compte est supprimé, ses recherches sauvegardées le sont aussi (événement
 *       user.deleted), sinon on garderait des données d'une personne qui est partie.
 *   Pour lire/écrire la base il demande au repository.
 *
 *   Ce service STOCKE les critères. L'envoi de l'alerte (comparer chaque nouvelle déclaration à
 *   ces critères, puis prévenir la personne) n'est pas encore branché : il faudra un service
 *   d'envoi (email ou notification) et l'événement declaration.created.
 *
 * UTILISÉ PAR
 *   - controllers/search/search.controller.js
 *   - container/search.js (le crée et lui donne ses dépendances)
 *
 * UTILISE
 *   - repositories/search/saved-search.repository.js (reçu : savedSearchRepository)
 *   - eventBus (reçu) : pour écouter user.deleted
 *   - constants/search/saved-search-options.js, constants/common/events.js
 *   - exceptions/app-error.js (SavedSearchLimitError, NotFoundError)
 */
import { EVENTS } from '../../constants/common/events.js';
import { MAX_SAVED_SEARCHES_PER_USER } from '../../constants/search/saved-search-options.js';
import { NotFoundError, SavedSearchLimitError } from '../../exceptions/app-error.js';

// requireAuth met un document Mongoose dans req.user : il a _id ET id. Les tests passent parfois
// un simple { id, role }. On accepte les deux.
const ownerIdOf = (user) => user._id ?? user.id;

export function createSavedSearchService({
  savedSearchRepository,
  eventBus,
  maxPerUser = MAX_SAVED_SEARCHES_PER_USER, // injectable : un test peut mettre une limite de 2
}) {
  // Le service s'abonne lui-même au bus : personne d'autre n'a besoin de connaître ce nettoyage.
  // Le payload de user.deleted est { userId, deletedAt }. eventBus?. : sans bus, on ignore.
  eventBus?.on(EVENTS.USER_DELETED, ({ userId }) => savedSearchRepository.deleteAllByOwner(userId));

  return {
    // POST /search/saved. `input` = { name?, q?, type?, ... } déjà nettoyé par Joi.
    async save(user, input) {
      const owner = ownerIdOf(user);

      // Limite par utilisateur. (Deux requêtes parfaitement simultanées pourraient dépasser de 1 :
      // sans conséquence pour une limite de confort, donc pas de verrou.)
      if ((await savedSearchRepository.countByOwner(owner)) >= maxPerUser) {
        throw new SavedSearchLimitError(
          `You can keep at most ${maxPerUser} saved searches, delete one first`,
        );
      }

      // Le nom est à part ; tout le reste est un critère.
      const { name, ...criteria } = input;
      return savedSearchRepository.create({ owner, name: name ?? null, criteria });
    },

    // GET /search/saved : MES alertes, la plus récente d'abord.
    list(user) {
      return savedSearchRepository.listByOwner(ownerIdOf(user));
    },

    // DELETE /search/saved/:id. Le repository filtre sur l'id ET le propriétaire : "n'existe pas"
    // et "appartient à un autre" sont indiscernables, les deux donnent 404.
    async remove(user, id) {
      const deleted = await savedSearchRepository.deleteByIdAndOwner(id, ownerIdOf(user));
      if (!deleted) throw new NotFoundError('Saved search not found');
    },
  };
}
