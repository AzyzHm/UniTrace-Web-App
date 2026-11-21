import { toPublicDeclarationResponse } from '../../presenters/declarations/declaration.presenter.js';
import { toSavedSearchResponse } from '../../presenters/search/saved-search.presenter.js';

export function createSearchController({ searchService, savedSearchService }) {
  // Garde : si on oublie de fournir un service, l'application refuse de démarrer, au lieu de
  // planter chez le premier utilisateur.
  if (!searchService) {
    throw new Error('createSearchController(): searchService is required');
  }
  if (!savedSearchService) {
    throw new Error('createSearchController(): savedSearchService is required');
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

    // POST /search/saved : req.body est déjà validé et nettoyé (validateSavedSearch).
    // 201 Created + la recherche créée, pour que le front l'ajoute à sa liste sans la recharger.
    async saveSearch(req, res) {
      const saved = await savedSearchService.save(req.user, req.body);

      res.status(201).json({ savedSearch: toSavedSearchResponse(saved) });
    },

    // GET /search/saved : { data: [...] }, même enveloppe que la recherche de déclarations.
    async listSavedSearches(req, res) {
      const items = await savedSearchService.list(req.user);

      res.status(200).json({ data: items.map(toSavedSearchResponse) });
    },

    // DELETE /search/saved/:id : 204 No Content (rien à renvoyer), comme DELETE /declarations/:id.
    async deleteSavedSearch(req, res) {
      await savedSearchService.remove(req.user, req.params.id);

      res.status(204).end();
    },

    // GET /search/:id : une déclaration. Presenter PUBLIC, comme dans la liste de recherche :
    // ni privateInfo ni owner, quel que soit l'utilisateur.
    async getDeclaration(req, res) {
      const found = await searchService.getDeclarationById(req.user, req.params.id);

      res.status(200).json({ declaration: toPublicDeclarationResponse(found) });
    },
  };
}
