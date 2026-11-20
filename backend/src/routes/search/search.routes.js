/**
 * FICHIER : routes/search/search.routes.js
 *
 * RÔLE
 *   Déclare les 6 adresses de la recherche et l'ORDRE des contrôles que chaque requête doit
 *   passer avant d'atteindre le controller. Montées sur /api/v1/search.
 *
 *     GET    /search/declarations  recherche combinée : texte (q), type, category, location,
 *                                  color, status, dateFrom, dateTo, hasPhoto, sort, page, limit
 *     GET    /search/filters       valeurs des listes déroulantes (cache de 5 minutes)
 *     POST   /search/saved         sauvegarder une recherche (pour être alerté)
 *     GET    /search/saved         lister mes recherches sauvegardées
 *     DELETE /search/saved/:id     supprimer une de mes recherches sauvegardées
 *     GET    /search/:id           lire UNE déclaration
 *
 *   ATTENTION À L'ORDRE DES ROUTES : GET /:id est déclarée EN DERNIER. Express teste les routes
 *   dans l'ordre où elles sont écrites ; si /:id passait avant, "/search/filters" ou
 *   "/search/saved" seraient lues comme un id "filters" / "saved".
 *
 * UTILISÉ PAR
 *   - routes/index.js (monte ce routeur sous /search)
 *
 * UTILISE
 *   - controllers/search/search.controller.js (reçu en paramètre : searchController)
 *   - middlewares/auth/require-auth.js        (reçu en paramètre : requireAuth)
 *   - validators/search/search.validator.js   (schéma reçu en paramètre : searchQuerySchema)
 *   - validators/search/saved-search.validator.js (schéma reçu : savedSearchSchema)
 *   - middlewares/search/validate-search-query.js (validation de la query)
 *   - middlewares/search/validate-saved-search.js (validation du corps de POST /saved)
 *   - middlewares/common/validate-object-id.js    (validation de :id)
 *   - middlewares/common/rate-limiters.js     (limiteurs reçus + noLimit en repli)
 */
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
