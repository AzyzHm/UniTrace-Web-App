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
  // Une réponse par rôle ("admin" / "user"), car seule la liste des statuts diffère.
  const filtersCache = new Map();

  // Compteur augmenté à chaque invalidation. Il détecte un calcul commencé AVANT un événement :
  // sans lui, ce calcul serait mis en cache et servirait des données trop vieilles pendant 5 min.
  let generation = 0;

  const invalidateFilters = () => {
    generation += 1;
    filtersCache.clear();
  };
  // Le service s'abonne lui-même au bus : personne d'autre n'a besoin de connaître son cache.
  // eventBus?. : si aucun bus n'est fourni (certains tests), on ignore simplement.
  for (const event of INVALIDATING_EVENTS) eventBus?.on(event, invalidateFilters);

  // Fabrique l'objet des listes déroulantes (appelée seulement quand le cache est vide/expiré).
  async function buildFilters(isAdmin) {
    // Les deux requêtes (lieux, couleurs) partent EN PARALLÈLE.
    const [locations, colors] = await Promise.all([
      searchRepository.topLocations(MAX_LOCATION_OPTIONS),
      searchRepository.topColors(MAX_COLOR_OPTIONS),
    ]);
    // Un admin voit les 6 statuts, un utilisateur normal seulement 4.
    const statusKeys = isAdmin ? DECLARATION_STATUS_VALUES : PUBLIC_STATUSES;

    return {
      type: toOptions(DECLARATION_TYPE_VALUES, TYPE_LABELS),
      categories: toOptions(CATEGORY_KEYS, CATEGORY_LABELS),
      // Lieux = texte libre dans le modèle : la valeur sert à la fois de clé et de libellé.
      locations: locations
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .map((value) => ({ key: value, label: value })),
      colors: colors.sort((a, b) => a.localeCompare(b, 'fr')),
      statuses: toOptions(statusKeys, STATUS_LABELS),
      hasPhoto: HAS_PHOTO_OPTIONS,
    };
  }

  return {
    // ============================ RECHERCHE DE DÉCLARATIONS ================================
    // `user` : { id, role } (de requireAuth). `query` : déjà nettoyée par le validator Joi.
    async searchDeclarations(user, query) {
      const isAdmin = isAdminRole(user.role);
      const { page, limit, sort } = query;

      // ÉTAPE A - texte. Un q trop court ("a") devient null : ignoré, sans erreur.
      const q = query.q && query.q.trim().length >= MIN_TEXT_QUERY_LENGTH ? query.q.trim() : null;

      // Trier par pertinence n'a de sens qu'avec un texte. Comme le contrôle est fait APRÈS le
      // nettoyage de q, sort=relevance&q=a est aussi refusé.
      if (sort === SEARCH_SORTS.RELEVANCE && !q) throw new RelevanceRequiresQueryError();

      // ÉTAPE B - statuts et droits. Sans statut demandé : pending + matched (déclarations actives).
      const statuses = query.status ?? [...DEFAULT_SEARCH_STATUSES];
      const refused = statuses.filter((status) => ADMIN_ONLY_STATUSES.includes(status));
      // Un non-admin qui réclame hidden/deleted reçoit une erreur claire (400), pas un retrait silencieux.
      if (!isAdmin && refused.length > 0) {
        throw new StatusForbiddenError(
          `The status ${refused.join(', ')} cannot be searched with your role`,
          refused.map((status) => ({ field: 'status', message: `${status} is not allowed` })),
        );
      }

      // Critères normalisés : tout critère absent devient null (plus simple pour le builder).
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

      // ÉTAPE C - filtre MongoDB puis comptage du total.
      let filter = buildSearchFilter(criteria);
      let total = await searchRepository.count(filter);

      // REPLI DU LIEU : aucun résultat avec le lieu exact -> on réessaie sans casse ni accents et
      // en acceptant une partie du texte. Exemple : "bibliotheque" trouve "Bibliothèque, 2e étage".
      if (total === 0 && criteria.location) {
        filter = buildSearchFilter({ ...criteria, locationMode: 'loose' });
        total = await searchRepository.count(filter);
      }

      // ÉTAPE D - la page demandée. skip = combien de résultats sauter (page 3, limite 10 -> 20).
      const skip = (page - 1) * limit;
      const totalPages = Math.ceil(total / limit);

      // Page au-delà de la dernière : on ne fait même pas la requête et on rend une liste vide.
      // C'est une réponse 200 avec data: [] (pas une erreur 404).
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

      // ÉTAPE E - réponse. Le controller transformera `items` avec le presenter public.
      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        sort: SORT_DESCRIPTIONS[sort],
        // appliedFilters = ce qui a RÉELLEMENT été appliqué (q: null si trop court, statuts par
        // défaut...). Le front peut afficher "filtres actifs" sans deviner.
        appliedFilters: {
          q,
          type: criteria.type,
          category: criteria.category,
          location: criteria.location,
          color: criteria.color,
          status: statuses,
          dateFrom: criteria.dateFrom,
          dateTo: criteria.dateTo,
          hasPhoto: criteria.hasPhoto,
        },
        noResults: total === 0,
      };
    },

    // ============================ UNE SEULE DÉCLARATION ====================================
    // GET /search/:id. `id` est déjà vérifié par validateObjectId (24 caractères hexadécimaux).
    //
    // Règle de visibilité, volontairement IDENTIQUE à celle de la liste :
    //   - tout utilisateur connecté voit pending, matched, resolved, expired ;
    //   - hidden et deleted (et toute déclaration supprimée en douceur, deletedAt rempli) ne sont
    //     visibles que par un admin, exactement comme avec ?status=hidden dans la recherche.
    // Pour un utilisateur normal, ces déclarations répondent 404 (comme si elles n'existaient pas) :
    // un 403 révélerait qu'elles existent.
    async getDeclarationById(user, id) {
      const found = await searchRepository.findById(id);
      if (!found) throw new NotFoundError('Declaration not found');

      const isHiddenFromUsers =
        ADMIN_ONLY_STATUSES.includes(found.status) || Boolean(found.deletedAt);
      if (isHiddenFromUsers && !isAdminRole(user.role)) {
        throw new NotFoundError('Declaration not found');
      }

      // Le controller la passera au presenter PUBLIC : pas de privateInfo ni d'owner, même pour
      // le propriétaire ou un admin (le détail complet reste sur GET /declarations/:id).
      return found;
    },

    // ============================ LISTES DÉROULANTES (avec cache) ==========================
    async getFilters(user) {
      const isAdmin = isAdminRole(user.role);
      const key = `${isAdmin ? 'admin' : 'user'}:filters`;
      const now = clock().getTime();

      // Cache valide : on le renvoie sans toucher à la base.
      const cached = filtersCache.get(key);
      if (cached && cached.expiresAt > now) return cached.promise;

      const startedAt = generation;
      // On met en cache la PROMESSE (pas le résultat) : deux requêtes simultanées partagent un
      // seul calcul au lieu de requêter toutes les deux la base.
      const promise = buildFilters(isAdmin);
      filtersCache.set(key, { promise, expiresAt: now + cacheTtlMs });

      try {
        return await promise;
      } catch (err) {
        // Un échec n'est pas gardé 5 minutes.
        if (filtersCache.get(key)?.promise === promise) filtersCache.delete(key);
        throw err;
      } finally {
        // Un événement est survenu PENDANT le calcul : ce résultat est déjà périmé, on le jette.
        if (generation !== startedAt && filtersCache.get(key)?.promise === promise) {
          filtersCache.delete(key);
        }
      }
    },
  };
}
