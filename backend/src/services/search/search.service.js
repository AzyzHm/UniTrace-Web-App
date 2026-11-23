/**
 * FICHIER : services/search/search.service.js
 *
 * RÔLE
 *   "Chef de cuisine" de la recherche : toutes les RÈGLES MÉTIER sont ici.
 *     - valeurs par défaut (statuts pending et matched, tri par date décroissante)
 *     - droits selon le rôle (hidden et deleted réservés aux admins)
 *     - texte trop court ignoré, tri "pertinence" refusé sans texte
 *     - pagination (page, limite, totalPages, hasNext, hasPrev)
 *     - repli du filtre "lieu" (exact, puis sans casse ni accents)
 *     - cache de 5 minutes des listes de filtres, vidé quand une déclaration change
 *     - lecture d'UNE déclaration (GET /search/:id) : supprimée ou cachée = introuvable, sauf admin
 *     - facettes de recherche ($facet) : compteurs par catégorie/type/statut, opt-in
 *   Pour lire la base il demande au repository ; pour fabriquer le filtre MongoDB il appelle le builder.
 *
 * UTILISÉ PAR
 *   - controllers/search/search.controller.js
 *   - container/search.js (le crée et lui donne ses dépendances)
 *
 * UTILISE
 *   - repositories/search/search.repository.js (reçu : searchRepository)
 *   - eventBus (reçu) : pour écouter les événements et vider le cache
 *   - services/search/search-filter-builder.js (buildSearchFilter)
 *   - constants/search/* (options, libellés), constants/declarations/*, constants/common/roles.js
 *   - exceptions/app-error.js (RelevanceRequiresQueryError, StatusForbiddenError)
 */
import { EVENTS } from '../../constants/common/events.js';
import { DECLARATION_STATUS_VALUES } from '../../constants/declarations/declaration-status.js';
import { CATEGORY_KEYS } from '../../constants/declarations/categories.js';
import { DECLARATION_TYPE_VALUES } from '../../constants/declarations/declaration-types.js';
import {
  CATEGORY_LABELS,
  HAS_PHOTO_OPTIONS,
  STATUS_LABELS,
  TYPE_LABELS,
} from '../../constants/search/filter-labels.js';
import {
  ADMIN_ONLY_STATUSES,
  DEFAULT_SEARCH_STATUSES,
  FILTERS_CACHE_TTL_MS,
  MAX_COLOR_OPTIONS,
  MAX_LOCATION_OPTIONS,
  MIN_TEXT_QUERY_LENGTH,
  PUBLIC_STATUSES,
  SEARCH_SORTS,
} from '../../constants/search/search-options.js';
import {
  NotFoundError,
  RelevanceRequiresQueryError,
  StatusForbiddenError,
} from '../../exceptions/app-error.js';
import { isAdminRole } from '../../constants/common/roles.js';
import { buildSearchFilter } from './search-filter-builder.js';

// Table de traduction : le nom du tri dans l'URL (ex. "date_desc") devient un champ + un sens.
// Elle sert deux fois : dire au repository comment trier, et répondre au client quel tri a été appliqué.
const SORT_DESCRIPTIONS = Object.freeze({
  [SEARCH_SORTS.DATE_DESC]: { field: 'date', order: 'desc' },
  [SEARCH_SORTS.DATE_ASC]: { field: 'date', order: 'asc' },
  [SEARCH_SORTS.CREATED_AT_DESC]: { field: 'createdAt', order: 'desc' },
  [SEARCH_SORTS.CREATED_AT_ASC]: { field: 'createdAt', order: 'asc' },
  [SEARCH_SORTS.RELEVANCE]: { field: 'relevance', order: 'desc' },
});

// Événements qui rendent le cache des filtres faux (lieux et couleurs peuvent avoir changé).
// USER_DELETED est inclus : supprimer un compte passe ses déclarations en "deleted".
const INVALIDATING_EVENTS = Object.freeze([
  EVENTS.DECLARATION_CREATED,
  EVENTS.DECLARATION_UPDATED,
  EVENTS.DECLARATION_STATUS_CHANGED,
  EVENTS.USER_DELETED,
]);

// Transforme ['lost', 'found'] + dictionnaire en [{ key: 'lost', label: 'Perdu' }, ...].
const toOptions = (keys, labels) => keys.map((key) => ({ key, label: labels[key] }));

export function createSearchService({
  searchRepository,
  eventBus,
  clock = () => new Date(), // horloge injectable : un test peut "avancer le temps"
  cacheTtlMs = FILTERS_CACHE_TTL_MS,
}) {
  // ------------------------------- CACHE DES FILTRES -------------------------------------
  const filtersCache = new Map();
  let generation = 0;

  const invalidateFilters = () => {
    generation += 1;
    filtersCache.clear();
  };

  for (const event of INVALIDATING_EVENTS) eventBus?.on(event, invalidateFilters);

  async function buildFilters(isAdmin) {
    const [locations, colors] = await Promise.all([
      searchRepository.topLocations(MAX_LOCATION_OPTIONS),
      searchRepository.topColors(MAX_COLOR_OPTIONS),
    ]);
    const statusKeys = isAdmin ? DECLARATION_STATUS_VALUES : PUBLIC_STATUSES;

    return {
      type: toOptions(DECLARATION_TYPE_VALUES, TYPE_LABELS),
      categories: toOptions(CATEGORY_KEYS, CATEGORY_LABELS),
      locations: locations
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .map((value) => ({ key: value, label: value })),
      colors: colors.sort((a, b) => a.localeCompare(b, 'fr')),
      statuses: toOptions(statusKeys, STATUS_LABELS),
      hasPhoto: HAS_PHOTO_OPTIONS,
    };
  }

  // Construit l'objet appliedFilters, partagé par les deux chemins (avec et sans facettes).
  function buildAppliedFilters({ q, criteria, statuses }) {
    return {
      q,
      type: criteria.type,
      category: criteria.category,
      location: criteria.location,
      color: criteria.color,
      status: statuses,
      dateFrom: criteria.dateFrom,
      dateTo: criteria.dateTo,
      hasPhoto: criteria.hasPhoto,
    };
  }

  // Construit la pagination, partagée par les deux chemins.
  function buildPagination({ page, limit, total }) {
    const totalPages = Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  return {
    // ============================ RECHERCHE DE DÉCLARATIONS ================================
    async searchDeclarations(user, query) {
      const isAdmin = isAdminRole(user.role);
      const { page, limit, sort } = query;

      const q = query.q && query.q.trim().length >= MIN_TEXT_QUERY_LENGTH ? query.q.trim() : null;

      if (sort === SEARCH_SORTS.RELEVANCE && !q) throw new RelevanceRequiresQueryError();

      const statuses = query.status ?? [...DEFAULT_SEARCH_STATUSES];
      const refused = statuses.filter((status) => ADMIN_ONLY_STATUSES.includes(status));

      if (!isAdmin && refused.length > 0) {
        throw new StatusForbiddenError(
          `The status ${refused.join(', ')} cannot be searched with your role`,
          refused.map((status) => ({ field: 'status', message: `${status} is not allowed` })),
        );
      }

      const criteria = {
        statuses,
        type: query.type ?? null,
        category: query.category ?? null,
        location: query.location ?? null,
        color: query.color ?? null,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        hasPhoto: query.hasPhoto ?? null,
        q,
      };

      let filter = buildSearchFilter(criteria);
      const requestedFacets = query.facets ?? [];

      // ---------- CHEMIN 1 : AVEC FACETTES ----------
      if (requestedFacets.length > 0) {
        const skip = (page - 1) * limit;
        const { field, order } = SORT_DESCRIPTIONS[sort];

        const result = await searchRepository.searchWithFacets(filter, {
          sortField: field,
          direction: order === 'asc' ? 1 : -1,
          skip,
          limit,
          byRelevance: sort === SEARCH_SORTS.RELEVANCE,
          facets: requestedFacets,
        });

        const total = result.total;

        return {
          items: result.items,
          pagination: buildPagination({ page, limit, total }),
          sort: SORT_DESCRIPTIONS[sort],
          appliedFilters: buildAppliedFilters({ q, criteria, statuses }),
          facets: result.facets,
          noResults: total === 0,
        };
      }

      // ---------- CHEMIN 2 : SANS FACETTES ----------
      let total = await searchRepository.count(filter);

      if (total === 0 && criteria.location) {
        filter = buildSearchFilter({ ...criteria, locationMode: 'loose' });
        total = await searchRepository.count(filter);
      }

      const skip = (page - 1) * limit;
      let items = [];
      
      if (skip < total) {
        const { field, order } = SORT_DESCRIPTIONS[sort];
        items = await searchRepository.findPage(filter, {
          sortField: field,
          direction: order === 'asc' ? 1 : -1,
          skip,
          limit,
          byRelevance: sort === SEARCH_SORTS.RELEVANCE,
        });
      }

      return {
        items,
        pagination: buildPagination({ page, limit, total }),
        sort: SORT_DESCRIPTIONS[sort],
        appliedFilters: buildAppliedFilters({ q, criteria, statuses }),
        noResults: total === 0,
      };
    },

    // ============================ UNE SEULE DÉCLARATION ====================================
    async getDeclarationById(user, id) {
      const found = await searchRepository.findById(id);
      if (!found) throw new NotFoundError('Declaration not found');

      const isHiddenFromUsers =
        ADMIN_ONLY_STATUSES.includes(found.status) || Boolean(found.deletedAt);
      if (isHiddenFromUsers && !isAdminRole(user.role)) {
        throw new NotFoundError('Declaration not found');
      }

      return found;
    },

    // ============================ LISTES DÉROULANTES (avec cache) ==========================
    async getFilters(user) {
      const isAdmin = isAdminRole(user.role);
      const key = `${isAdmin ? 'admin' : 'user'}:filters`;
      const now = clock().getTime();

      const cached = filtersCache.get(key);
      if (cached && cached.expiresAt > now) return cached.promise;

      const startedAt = generation;
      const promise = buildFilters(isAdmin);
      filtersCache.set(key, { promise, expiresAt: now + cacheTtlMs });

      try {
        return await promise;
      } catch (err) {
        if (filtersCache.get(key)?.promise === promise) filtersCache.delete(key);
        throw err;
      } finally {
        if (generation !== startedAt && filtersCache.get(key)?.promise === promise) {
          filtersCache.delete(key);
        }
      }
    },
  };
}