/**
 * FICHIER : container/search.js
 *
 * RÔLE
 *   "Assembleur" du module recherche. Au démarrage de l'application, il fabrique le repository
 *   et le service de recherche et les branche entre eux (injection de dépendances). Aucun autre
 *   fichier ne crée ses propres dépendances : tout passe par le container.
 *
 *   Avantage : dans un test on peut remplacer n'importe quelle pièce par un faux
 *   (ex. createContainer({ overrides: { searchRepository: fauxRepo } })).
 *
 * UTILISÉ PAR
 *   - container/index.js (appelle buildSearch après common, auth, users et declarations)
 *
 * UTILISE
 *   - repositories/search/search.repository.js (createSearchRepository)
 *   - repositories/search/saved-search.repository.js (createSavedSearchRepository)
 *   - services/search/search.service.js (createSearchService)
 *   - services/search/saved-search.service.js (createSavedSearchService)
 *   - `common` (créé dans container/common.js) : eventBus et clock
 */
import { createSavedSearchRepository } from '../repositories/search/saved-search.repository.js';
import { createSearchRepository } from '../repositories/search/search.repository.js';
import { createSavedSearchService } from '../services/search/saved-search.service.js';
import { createSearchService } from '../services/search/search.service.js';

// `common` = pièces partagées par tous les domaines ; `use` = fabrique avec possibilité de remplacement en test.
export function buildSearch({ common, use }) {
  // eventBus : le service s'y abonne pour vider son cache. clock : horloge (contrôlable en test).
  const { eventBus, clock } = common;

  // use('nom', fabrique) crée la pièce, sauf si un test a fourni un remplaçant sous ce nom.
  const searchRepository = use('searchRepository', createSearchRepository);
  const savedSearchRepository = use('savedSearchRepository', createSavedSearchRepository);

  const services = {
    // Le service reçoit tout ce dont il a besoin ; il n'importe rien d'autre.
    searchService: createSearchService({ searchRepository, eventBus, clock }),
    // Il écoute aussi user.deleted (via eventBus) pour effacer les alertes d'un compte supprimé.
    savedSearchService: createSavedSearchService({ savedSearchRepository, eventBus }),
  };

  // `services` est fusionné avec ceux des autres domaines dans container/index.js.
  return { services, searchRepository, savedSearchRepository };
}
