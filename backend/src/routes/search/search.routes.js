/**
 * FICHIER : routes/search/search.routes.js
 *
 * RÔLE
 *   Déclare les 2 adresses de la recherche et l'ORDRE des contrôles que chaque requête doit
 *   passer avant d'atteindre le controller. Montées sur /api/v1/search.
 *
 *     GET /api/v1/search/declarations  recherche combinée : texte (q), type, category, location,
 *                                      color, status, dateFrom, dateTo, hasPhoto, sort, page, limit
 *     GET /api/v1/search/filters       valeurs des listes déroulantes (cache de 5 minutes)
 *
 *   Volontairement absents : GET /search/:id (GET /declarations/:id existe déjà) et les
 *   recherches enregistrées (reportées après le MVP).
 *
 * UTILISÉ PAR
 *   - routes/index.js (monte ce routeur sous /search)
 *
 * UTILISE
 *   - controllers/search/search.controller.js (reçu en paramètre : searchController)
 *   - middlewares/auth/require-auth.js        (reçu en paramètre : requireAuth)
 *   - validators/search/search.validator.js   (schéma reçu en paramètre : searchQuerySchema)
 *   - middlewares/search/validate-search-query.js (validation de la query)
 *   - middlewares/common/rate-limiters.js     (limiteurs reçus + noLimit en repli)
 */
import { Router } from 'express';
import { noLimit } from '../../middlewares/common/rate-limiters.js';
import { validateSearchQuery } from '../../middlewares/search/validate-search-query.js';

// Fabrique : tout arrive en paramètre (injection de dépendances), rien n'est importé en dur.
export function createSearchRoutes({
  searchController,
  requireAuth,
  searchQuerySchema,
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

  return router;
}
