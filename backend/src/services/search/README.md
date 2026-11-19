# Search (binome 2)

Two endpoints, both behind `requireAuth`, mounted on `/api/v1/search`.

| Method | Route                  | Limiter                            | Role                                       |
| ------ | ---------------------- | ---------------------------------- | ------------------------------------------ |
| GET    | `/search/declarations` | `search` (50 / min / user)         | Combined search: filters, sort, pagination |
| GET    | `/search/filters`      | `searchFilters` (120 / min / user) | Values of the dropdowns of the search form |

Not built on purpose: `GET /search/:id` (use `GET /declarations/:id`) and saved searches.

## Layers

`routes/search` → `controllers/search` → `services/search/search.service.js` →
`repositories/search`. The filter is built by the pure function `search-filter-builder.js`, which
the unit tests check without a database. Everything is wired in `container/search.js`, and the
query is validated by `validators/search/search.validator.js` through
`middlewares/search/validate-search-query.js`.

## Decisions

- **Defaults**: `status=pending,matched`, both types, `sort=date_desc`, `page=1`, `limit=20`
  (max 50, taken from `PAGINATION`).
- **Statuses**: `?status=a,b` and `?status=a&status=b` are the same. `hidden` and `deleted` are
  refused to a non-admin with `400 STATUS_FORBIDDEN` (not silently removed). `resolved` and
  `expired` are open to everyone but not in the default. `deletedAt: null` is always applied,
  except when an admin asks for `deleted`.
- **Privacy**: results always go through `toPublicDeclarationResponse`, for every role. The
  repository also excludes `privateInfo`, `owner` and `statusBeforeHidden` from the query.
  `hasPhoto` follows what a user can see: the picture of a sensitive category (student card) does
  not count.
- **Filters are combined with AND.** An unknown parameter is `400 INVALID_QUERY`.
- **Text (`q`)**: MongoDB text index `search_text_idx` on title (weight 3) and description
  (weight 1), language French. `q` shorter than 2 characters is ignored (`appliedFilters.q` is
  `null`). `sort=relevance` without a usable `q` is `400 RELEVANCE_REQUIRES_Q`.
- **Location** is free text in the model. The exact value is tried first. If it finds nothing, the
  search is repeated ignoring case and accents and matching a part of the text. To be confirmed
  with binome 1, see below.
- **Dates**: `dateTo=2026-10-31` (date only) includes the whole 31st.
- **Sort and pages**: `_id` breaks ties, so pages never repeat or skip a declaration. A page after
  the last one is `200` with `data: []`. No result is `200` with `noResults: true`.
- **Rate limit**: counted per user (not per IP), `429 RATE_LIMITED` with a `Retry-After` header.
  The two routes have separate counters.
- **Filter lists cache**: 5 minutes, one entry per role (`admin` / `user`), emptied on
  `declaration.created`, `declaration.updated`, `declaration.statusChanged` and `user.deleted`.
  Requests arriving together share one computation. Locations and colors are free text, so only
  the 100 and 30 most used values of the active declarations are listed.

## Indexes

Defined once in `models/declarations/declaration-search-indexes.js`. The model registers them
(so a new database gets them from `autoIndex`), and an existing one can get them with:

```sh
npm run add-search-indexes
```

To check the speed with 10 000 declarations: `npm run seed` then `npm run seed:search`
(`SEED_CLEAN=1 npm run seed:search` removes them). To check that a query uses an index, run it
with `.explain('executionStats')` in `mongosh`.

## Tests

- `tests/unit/search`: validator, filter builder, service (cache, events, roles) and the HTTP
  routes with a fake repository.
- `tests/integration/search`: real queries on the in-memory database.
- `docs/search.postman_collection.json`: 16 scenarios for the Collection Runner.

## Open points for binome 1

1. `location` is free text. If it becomes an enum, `locations` in `/search/filters` becomes a
   static list and the loose fallback can go.
2. Four indexes are added to `declaration.model.js` (they are in the model file, so they need a
   review from the owner of the model).
3. Optional `searchText` field (lowercase, no accents) for accent insensitive text search: not
   done, it needs a model change. Today the French stemmer already ignores some accents, but not all.
4. `attributes.color` is compared as typed. The seed uses English values (`black`), the form may
   use French ones: agree on the values, or on a list of colors.
