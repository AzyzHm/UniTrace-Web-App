/**
 * FICHIER : controllers/search/search.controller.js
 *
 * RÔLE
 *   "Serveur de salle" de la recherche : il prend la requête HTTP, la transmet au service, puis
 *   met la réponse en forme. Il ne contient AUCUNE règle métier (elles sont dans le service).
 *
 * UTILISÉ PAR
 *   - routes/index.js (crée le controller) puis routes/search/search.routes.js (l'appelle)
 *
 * UTILISE
 *   - services/search/search.service.js (reçu en paramètre : searchService)
 *   - presenters/declarations/declaration.presenter.js (toPublicDeclarationResponse)
 */
import { toPublicDeclarationResponse } from '../../presenters/declarations/declaration.presenter.js';

export function createSearchController({ searchService }) {
  // Garde : si on oublie de fournir le service, l'application refuse de démarrer, au lieu de
  // planter chez le premier utilisateur.
  if (!searchService) {
    throw new Error('createSearchController(): searchService is required');
  }

  return {
    // GET /search/declarations
    async searchDeclarations(req, res) {
      // req.user : défini par requireAuth (id et rôle).
      // req.query : déjà validée et nettoyée (types convertis, valeurs par défaut ajoutées).
      // Le service rend { items, pagination, sort, appliedFilters, noResults }.
      const { items, ...rest } = await searchService.searchDeclarations(req.user, req.query);

      // On utilise TOUJOURS le presenter public, quel que soit l'utilisateur : une recherche ne
      // renvoie jamais privateInfo ni owner, même pour le propriétaire ou un admin.
      res.status(200).json({ data: items.map(toPublicDeclarationResponse), ...rest });
    },

    // GET /search/filters : le service sait déjà quels statuts montrer selon le rôle.
    async getFilters(req, res) {
      res.status(200).json(await searchService.getFilters(req.user));
    },
  };
}
