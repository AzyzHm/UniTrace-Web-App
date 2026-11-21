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
