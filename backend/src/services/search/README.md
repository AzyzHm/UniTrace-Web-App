# Search (binome 2)

Six endpoints, all behind `requireAuth`, mounted on `/api/v1/search`.

| Method | Route                  | Middleware (after `requireAuth`)                          | Role                                               |
| ------ | ---------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| GET    | `/search/declarations` | `search` limiter (50 / min / user), `validateSearchQuery` | Combined search: filters, sort, pagination         |
| GET    | `/search/filters`      | `searchFilters` limiter (120 / min / user)                | Values of the dropdowns of the search form         |
| POST   | `/search/saved`        | `validateSavedSearch`                                     | Save the criteria of a search, to be alerted later |
| GET    | `/search/saved`        | none                                                      | List my saved searches                             |
| DELETE | `/search/saved/:id`    | `validateObjectId`                                        | Delete one of my saved searches                    |
| GET    | `/search/:id`          | `validateObjectId`                                        | Read ONE declaration (public shape)                |

`GET /search/:id` is declared **last** in `routes/search/search.routes.js`: Express tries routes in
the order they are written, so `/search/filters` and `/search/saved` must come before it or they
would be read as an id.

## Layers

`routes/search` → `controllers/search` → services → `repositories/search`.

- Search and `GET /search/:id`: `services/search/search.service.js` and
  `repositories/search/search.repository.js`. The filter is built by the pure function
  `search-filter-builder.js`, which the unit tests check without a database. The query is
  validated by `validators/search/search.validator.js` through
  `middlewares/search/validate-search-query.js`.
- Saved searches: `services/search/saved-search.service.js`,
  `repositories/search/saved-search.repository.js`, model `models/search/saved-search.model.js`
  (collection `savedsearches`), presenter `presenters/search/saved-search.presenter.js`. The body
  is validated by `validators/search/saved-search.validator.js` through
  `middlewares/search/validate-saved-search.js`.
- `middlewares/common/validate-object-id.js` checks `:id` (24 hexadecimal characters) for both
  `GET /search/:id` and `DELETE /search/saved/:id`.
- Everything is wired in `container/search.js`.

## Saved searches

A saved search is `{ owner, name?, criteria }`. Only the **criteria** are stored (the question),
never the results (the answer, which changes all the time).

| Endpoint                   | Success                                                  | Errors                                                                        |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /search/saved`       | `201 { savedSearch: { id, name, criteria, createdAt } }` | `400 VALIDATION_ERROR`, `409 SAVED_SEARCH_LIMIT`, `401`                       |
| `GET /search/saved`        | `200 { data: [ ...savedSearch ] }`, newest first         | `401`                                                                         |
| `DELETE /search/saved/:id` | `204`, no body                                           | `404 NOT_FOUND` (missing OR not mine), `400 VALIDATION_ERROR` (bad id), `401` |

Body of `POST /search/saved` (all optional, but **at least one criterion** is required):

```json
{
  "name": "My black bag",
  "q": "sac noir",
  "type": "lost",
  "category": "wallet_bag",
  "location": "Library",
  "color": "black",
  "dateFrom": "2026-10-01",
  "dateTo": "2026-10-31",
  "hasPhoto": false
}
```

- **Criteria** are the same fields and rules as the search (`q`, `type`, `category`, `location`,
  `color`, `dateFrom`, `dateTo`, `hasPhoto`): both schemas share `searchCriteriaFields`. Not
  allowed: `status`, `sort`, `page`, `limit` (they describe the display, not what is watched; a
  new declaration is always `pending`) and any other field, such as `owner` (`400`).
- `q` needs at least 2 characters here (the search silently ignores a shorter one, but an alert on
  an ignored text would watch nothing). `hasPhoto: false` counts as a criterion ("without photo").
  A date only `dateTo` is stored as the end of that day, as in the search.
- **Ownership**: every read and delete filters on the owner. A saved search of another user answers
  `404`, never `403`, so its existence is not revealed.
- **Limit**: 20 per user (`MAX_SAVED_SEARCHES_PER_USER`), then `409 SAVED_SEARCH_LIMIT`.
- **Account deletion**: the service listens to `user.deleted` and removes that user's saved
  searches.
- **Not built yet: sending the alert.** Today the criteria are only stored. Comparing each new
  declaration (`declaration.created`) with the saved criteria and notifying the user needs a
  sending service (email or notification) that does not exist in the project yet.

## GET /search/:id

Returns `200 { declaration }` in the **public** shape, like the results of the search: never
`privateInfo` or `owner`, for every role (including the owner and admins). The full view stays on
`GET /declarations/:id`. Same visibility as the search: `pending`, `matched`, `resolved`,
`expired` for everyone; `hidden`, `deleted` and soft deleted declarations (`deletedAt` set) are
`404` for a user (not `403`, so they look absent) and visible to an admin. Unknown id: `404`.
Malformed id: `400 VALIDATION_ERROR`.

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

- `tests/unit/search`: validators, filter builder, services (cache, events, roles, saved
  searches, `getDeclarationById`), presenter, model and the HTTP routes with a fake repository.
- `tests/unit/common/validate-object-id.test.js`: the `:id` middleware.
- `tests/integration/search`: `search.test.js` (queries), `saved-search.test.js` (save, list,
  delete, ownership, limit, account deletion) and `search-by-id.test.js`, on the in-memory
  database.
- `docs/search.postman_collection_search.json`: 28 scenarios for the Collection Runner
  (17 to 28 cover the saved searches and `GET /search/:id`).

## Open points for binome 1

1. `location` is free text. If it becomes an enum, `locations` in `/search/filters` becomes a
   static list and the loose fallback can go.
2. Four indexes are added to `declaration.model.js` (they are in the model file, so they need a
   review from the owner of the model).
3. Optional `searchText` field (lowercase, no accents) for accent insensitive text search: not
   done, it needs a model change. Today the French stemmer already ignores some accents, but not all.
4. `attributes.color` is compared as typed. The seed uses English values (`black`), the form may
   use French ones: agree on the values, or on a list of colors.
