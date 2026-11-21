import { Router } from 'express';
import { noLimit } from '../../middlewares/common/rate-limiters.js';
import { validateObjectId } from '../../middlewares/common/validate-object-id.js';
import { validateSavedSearch } from '../../middlewares/search/validate-saved-search.js';
import { validateSearchQuery } from '../../middlewares/search/validate-search-query.js';

// Fabrique : tout arrive en paramètre (injection de dépendances), rien n'est importé en dur.
export function createSearchRoutes({
  searchController,
  requireAuth,
  searchQuerySchema,
  savedSearchSchema,
  rateLimiters = {},
}) {
  const router = Router();

  // Si un limiteur n'est pas fourni (cas des tests), on utilise noLimit qui laisse tout passer.
  const { search = noLimit, searchFilters = noLimit } = rateLimiters;

  // Toutes les routes ci-dessous exigent un utilisateur connecté.
  // Placé en premier exprès : les limiteurs comptent PAR UTILISATEUR, donc req.user doit déjà exister.
  router.use(requireAuth);

  // Ordre des contrôles : 1) limite de requêtes  2) validation de la query  3) controller.
  // Une requête invalide s'arrête à l'étape 2 et ne touche jamais la base.
  router.get(
    '/declarations',
    search,
    validateSearchQuery(searchQuerySchema),
    searchController.searchDeclarations,
  );

  // Cette route ne lit aucun paramètre : rien à valider. Son limiteur est plus large car la
  // réponse est légère et mise en cache.
  router.get('/filters', searchFilters, searchController.getFilters);

  // ---- Recherches sauvegardées. Toutes sont déclarées AVANT GET /:id (voir l'en-tête).
  // POST : on valide le corps (au moins un critère, valeurs correctes) avant de toucher la base.
  router.post('/saved', validateSavedSearch(savedSearchSchema), searchController.saveSearch);

  // GET : aucun paramètre à valider ; le service ne renvoie que les alertes de req.user.
  router.get('/saved', searchController.listSavedSearches);

  // DELETE : validateObjectId refuse un id mal formé (400) avant toute requête MongoDB.
  router.delete('/saved/:id', validateObjectId(), searchController.deleteSavedSearch);

  // ---- Une seule déclaration. EN DERNIER : /:id attrape tout ce qui n'a pas été reconnu avant.
  router.get('/:id', validateObjectId(), searchController.getDeclaration);

  return router;
}
