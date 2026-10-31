# UniTrace

UniTrace is a web application that helps students and staff of a university recover lost belongings. People post a _declaration_ when they lose or find an item, and the platform tracks its life cycle (`pending`, `matched`, `resolved`, `expired`, `hidden`, `deleted`).

> **Status: in development.** Search, matching, the expiry job and the admin endpoints are not built yet. The list of what is missing lives in [backend/README.md, section 21](backend/README.md#21-not-implemented-yet).

---

## Table of contents

1. [Repository layout](#1-repository-layout)
2. [Where to find what](#2-where-to-find-what)
3. [Getting started](#3-getting-started)
4. [Backend architecture](#4-backend-architecture)
5. [Backend layer reference](#5-backend-layer-reference)
6. [Other backend folders](#6-other-backend-folders)
7. [Continuous integration](#7-continuous-integration)
8. [Keeping this documentation up to date](#8-keeping-this-documentation-up-to-date)
9. [License](#9-license)

---

## 1. Repository layout

```
UniTrace/
├── .github/workflows/ci.yml   Backend CI (runs on every pull request and every push to main)
├── backend/                   REST API: Node.js 24, Express 5, MongoDB (Mongoose)
├── LICENSE                    Apache License 2.0
└── README.md                  This file
```

---

## 2. Where to find what

This file is an **index and a quick start**. The detailed documentation lives next to the code, so it is updated in the same pull request as the code.

| I want to...                                          | Read                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Run the API, see every env variable and npm script    | [backend/README.md](backend/README.md), sections 2 to 4                                    |
| Understand the layers and dependency injection        | [backend/README.md](backend/README.md), section 6, and section 4 below                     |
| See every endpoint, error code and validation rule    | [backend/README.md](backend/README.md), sections 10, 12 and 13                             |
| Understand the declaration status rules               | [backend/README.md](backend/README.md), section 8                                          |
| Understand login, refresh tokens and sessions         | [backend/README.md](backend/README.md), section 9                                          |
| Add a new endpoint step by step                       | [backend/README.md](backend/README.md), section 20                                         |
| Know what one backend folder does, file by file       | The `README.md` inside that folder (see [section 5](#5-backend-layer-reference))           |
| Know what each test file covers                       | [backend/tests/README.md](backend/tests/README.md)                                         |
| Try the API without writing code                      | [backend/docs/unitrace.postman_collection.json](backend/docs/unitrace.postman_collection.json) |

---

## 3. Getting started

### Prerequisites

- Node.js **24 or newer**
- A MongoDB database (local instance or MongoDB Atlas)

### Backend

```bash
cd backend
npm install
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Open `.env` and set at least `MONGODB_URI`.

> **Local development tip.** `.env.example` contains placeholders for the AgentMail settings. Delete those lines or leave them empty. The server then prints verification codes in the console instead of sending emails. Leaving the placeholders in place makes the server refuse to start or every email fail.

```bash
npm run dev                 # API on http://localhost:3000 with auto-reload
curl http://localhost:3000/health
# {"status":"ok"}
```

Optional demo data:

```bash
SEED_PASSWORD='Passw0rdDemo' npm run seed
```

The seed creates an admin and a few users (for example `sara.k@isamm.uma.tn`) sharing the password you gave.

### Useful commands (run inside `backend/`)

| Command                | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `npm run dev`          | Start the API with auto-reload                     |
| `npm start`            | Start the API (production)                         |
| `npm test`             | Run all tests (unit and integration)               |
| `npm run lint`         | ESLint                                             |
| `npm run format`       | Prettier, write changes                            |
| `npm run format:check` | Prettier, check only (this is what CI runs)        |
| `npm run seed`         | Load demo users and declarations                   |

The full list of environment variables is in [backend/README.md, section 3](backend/README.md#3-configuration).

---

## 4. Backend architecture

The backend is split into layers, one folder per responsibility. Most layers are split again by domain (`auth`, `users`, `declarations`, `common`), so each team member knows which folder to touch.

### How a request travels

```
HTTP request
   │
   ▼
helmet ─► cors ─► rate limit ─► JSON parser ─► routes
                                                  │
                                                  ▼
            validate(Joi schema) ─► [requireAuth] ─► controller
                                                        │
                                                        ▼
                                                     service ──► eventBus.emit(...)
                                                        │
                                                        ▼
                                                   repository
                                                        │
                                                        ▼
                                                Mongoose model ──► MongoDB
```

A controller builds the response through a **presenter**. Any error thrown on the way goes to the central **error handler**, which always answers with `{ error: { code, message, details } }`.

### Layer responsibilities

| Layer            | Does                                                                 | Must not                                   |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| **container**    | Builds every component once and injects its dependencies             | Contain business rules                     |
| **routes**       | Maps URLs to middlewares and a controller method                     | Contain logic                              |
| **validators**   | Describes valid input (Joi)                                          | Know about the database                    |
| **middlewares**  | Cross-cutting HTTP concerns (validation, auth, uploads, errors)      | Contain business rules                     |
| **controllers**  | Reads `req`, calls one service method, picks status code and presenter | Query the database or make decisions     |
| **services**     | Business rules and permissions                                       | Import Mongoose models or Express objects  |
| **repositories** | Every database query                                                 | Know about HTTP or permissions             |
| **models**       | Schemas, indexes, last-line validation                               | Hold business logic                        |
| **presenters**   | Decide which fields leave the server for each type of reader         | Query anything                             |
| **constants**    | One source of truth for values and rule tables                       | Import application code                    |
| **events**       | Let a module announce a fact without knowing who listens             | Be relied on for durability                |

### Dependency injection

Every component is built by a `createXxx({ dependencies })` factory. There are no classes and no DI framework. All wiring happens once, in `backend/src/container/`. `server.js` and the test helper `tests/helpers/build-test-app.js` both call `createContainer()`, so the app and its tests can never be wired differently, and a test can replace one piece (for example the email sender) through `overrides`.

### Key conventions

- Ids in events are strings, never ObjectIds.
- Status changes go through one rule table (`constants/declarations/transitions.js`) and are guarded against concurrent writes.
- Presenters are whitelists: a new model field stays private until it is added to a presenter on purpose.
- Constants shared by a model and a validator live in `constants/` so the two cannot disagree.

For the request lifecycle example, the domain model, the security design and the event list, see [backend/README.md](backend/README.md).

---

## 5. Backend layer reference

Every folder under `backend/src/` has its own `README.md` listing its files. The tables below summarize them. **The layer README is the source of truth**: if a table here and a layer README disagree, trust the layer README and fix this file.

Entry points of `backend/src/` ([README](backend/src/README.md)):

| File        | What it does                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `server.js` | Starts everything: connects to MongoDB, builds the container, creates the app, listens, shuts down cleanly |
| `app.js`    | `createApp()`: security headers, CORS, rate limiting, body parsing, `/health`, `/api/v1` router, 404 and error handlers |

### config ([README](backend/src/config/README.md))

| File        | What it does                                                                  |
| ----------- | ----------------------------------------------------------------------------- |
| `env.js`    | Validates `process.env` with Joi, applies defaults, exports a frozen `env` object |
| `logger.js` | Pino logger, pretty output in development                                     |

### constants ([README](backend/src/constants/README.md))

| File                                  | What it does                                                    |
| ------------------------------------- | --------------------------------------------------------------- |
| `common/roles.js`                     | Roles (`user`, `admin`), the `system` actor, `isAdminRole()`    |
| `common/events.js`                    | Names of the internal events                                    |
| `common/pagination.js`                | Default page, default limit, maximum limit                      |
| `common/rate-limits.js`               | Window and maximum count of each rate limiter                   |
| `auth/code-purposes.js`               | Purposes of a one-time code (email verification, password reset) |
| `auth/verification-code.js`           | Code length, lifetime, maximum attempts, resend cooldown        |
| `auth/refresh-token.js`               | Refresh token lifetime, cookie name and path                    |
| `declarations/declaration-types.js`   | `lost` and `found`                                              |
| `declarations/declaration-status.js`  | The statuses and the default one (`pending`)                    |
| `declarations/transitions.js`         | Transition table, `canTransition()`, `getAllowedTransitions()`  |
| `declarations/categories.js`          | Item categories with the high-value and sensitive flags         |
| `declarations/declaration-limits.js`  | Min and max lengths of the declaration fields                   |
| `declarations/picture.js`             | Picture field name, size limit, accepted types, URL base        |

### container ([README](backend/src/container/README.md))

| File              | What it does                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `index.js`        | `createContainer()`: builds the four domain parts in order, returns services, `requireAuth`, shared objects |
| `common.js`       | Event bus, email service, user repository                                                          |
| `auth.js`         | Hashers, token service, verification code, session, password reset, auth service, `requireAuth`    |
| `users.js`        | Profile, password change and account deletion services                                             |
| `declarations.js` | Declaration repository, picture storage, declaration and cleanup services, event listeners         |

### routes ([README](backend/src/routes/README.md))

| File                              | What it does                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `index.js`                        | `createApiRouter()`: mounts `/auth`, `/users`, `/declarations`; protects the last two with `requireAuth` |
| `auth/auth.routes.js`             | Register, verify, resend, login, refresh, logout, forgot and reset password         |
| `users/user.routes.js`            | `/me` read and update, change password, delete account                              |
| `declarations/declaration.routes.js` | Create, list mine, get, update, status, delete, picture routes (`/mine` before `/:id`) |

### validators ([README](backend/src/validators/README.md))

| File                                  | What it does                                              |
| ------------------------------------- | --------------------------------------------------------- |
| `auth/auth.validator.js`              | Schemas for all auth routes, shared password rules        |
| `users/user-fields.js`                | Reusable rules: username, phone, university email         |
| `users/user.validator.js`             | Update profile, change password, delete account           |
| `declarations/declaration-fields.js`  | Reusable rules for each declaration field                 |
| `declarations/declaration.validator.js` | Create, update, status, `:id`, picture body, list query |

### middlewares ([README](backend/src/middlewares/README.md))

| File                                 | What it does                                                         |
| ------------------------------------ | -------------------------------------------------------------------- |
| `auth/require-auth.js`               | Checks the Bearer token, loads the user, refuses deleted or suspended accounts |
| `common/validate.js`                 | `validate(schema, source)` for `body`, `params` or `query`           |
| `common/rate-limiters.js`            | Builds the four rate limiters                                        |
| `common/not-found.js`                | Turns unmatched routes into `NOT_FOUND`                              |
| `common/error-handler.js`            | Last middleware, shared error format, generic 500 for unexpected errors |
| `declarations/upload-picture.js`     | Multipart picture upload with multer, size limit, real type check    |

### controllers ([README](backend/src/controllers/README.md))

| File                                    | What it does                                                    |
| --------------------------------------- | --------------------------------------------------------------- |
| `auth/auth.controller.js`               | Auth routes, sets and clears the refresh cookie                 |
| `users/user.controller.js`              | Current user, profile update, password change, account deletion |
| `declarations/declaration.controller.js` | Declaration CRUD, status, picture; picks owner or public presenter |

### services ([README](backend/src/services/README.md))

| File                                      | What it does                                                          |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `auth/auth.service.js`                    | Register, verify email, resend verification                           |
| `auth/session.service.js`                 | Login, refresh (rotation and reuse detection), logout                 |
| `auth/password-reset.service.js`          | Forgot password and reset password                                    |
| `auth/verification-code.service.js`       | Issue, resend and check one-time codes                                |
| `auth/token.service.js`                   | Sign and verify JWT access tokens                                     |
| `auth/password-hasher.js`                 | bcrypt hash and compare                                               |
| `auth/code-hasher.js`                     | Generate numeric codes, HMAC them                                     |
| `auth/refresh-token-hasher.js`            | Generate and hash refresh tokens                                      |
| `users/profile.service.js`                | Update profile, re-verify on email change                             |
| `users/password-change.service.js`        | Change password, end other sessions                                   |
| `users/account-deletion.service.js`       | Anonymize account, remove tokens and codes, emit `user.deleted`       |
| `declarations/declaration.service.js`     | All declaration rules: CRUD, permissions, transitions, pictures       |
| `declarations/declaration-cleanup.service.js` | React to a deleted owner: erase private info, soft delete, remove pictures |
| `declarations/picture-storage.js`         | Save, resolve and remove picture files on disk                        |
| `common/email.service.js`                 | AgentMail sender, or console sender when not configured               |

### repositories ([README](backend/src/repositories/README.md))

| File                                        | What it does                                                        |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `users/user.repository.js`                  | Create, find, verify email, update password and profile, anonymize  |
| `auth/refresh-token.repository.js`          | Create, find, claim (single use), delete refresh tokens             |
| `auth/verification-code.repository.js`      | Store, find, count attempts, delete codes                           |
| `declarations/declaration.repository.js`    | Create, find, guarded update, list mine, bulk operations for account deletion |

### models ([README](backend/src/models/README.md))

| File                                  | What it does                                        |
| ------------------------------------- | --------------------------------------------------- |
| `users/user.model.js`                 | `User` schema                                       |
| `auth/refresh-token.model.js`         | `RefreshToken` schema (hash only, TTL index)        |
| `auth/verification-code.model.js`     | `VerificationCode` schema (one per user and purpose, TTL index) |
| `declarations/declaration.model.js`   | `Declaration` schema and indexes                    |

### presenters ([README](backend/src/presenters/README.md))

| File                                    | What it does                                                          |
| --------------------------------------- | --------------------------------------------------------------------- |
| `users/user.presenter.js`               | `toUserResponse()`, never includes the password                       |
| `declarations/declaration.presenter.js` | Owner and admin view, public view, list summaries                     |

### events ([README](backend/src/events/README.md))

| File                                    | What it does                                                  |
| --------------------------------------- | ------------------------------------------------------------- |
| `common/event-bus.js`                   | In-memory `on()` and `emit()`, a failing handler never breaks the emitter |
| `declarations/declaration-listeners.js` | Registers declaration listeners (today: `user.deleted` triggers cleanup) |

### exceptions ([README](backend/src/exceptions/README.md))

| File           | What it does                                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| `app-error.js` | `AppError` and one subclass per HTTP error (400, 401, 403, 404, 409, 413, 429)         |

### db ([README](backend/src/db/README.md))

| File            | What it does                                  |
| --------------- | --------------------------------------------- |
| `connection.js` | `connectDb(uri)` and `disconnectDb()`         |

### utils ([README](backend/src/utils/README.md))

| File                            | What it does                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `auth/refresh-cookie.js`        | Read, set and clear the refresh cookie                          |
| `declarations/image-type.js`    | Detect JPEG, PNG or WebP from the first bytes                   |

### seed ([README](backend/src/seed/README.md))

| File           | What it does                                                    |
| -------------- | --------------------------------------------------------------- |
| `seed-data.js` | The demo users and declarations                                 |
| `run-seed.js`  | `runSeed()`, safe to run twice                                  |

---

## 6. Other backend folders

| Folder                 | What it holds                                                                                           | README                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `backend/scripts/`     | Command-line scripts run by hand. Today: `seed.js` (`npm run seed`)                                      | [README](backend/scripts/README.md)     |
| `backend/tests/`       | Vitest suite. `unit/` uses fakes and no database, `integration/` calls the real app on an in-memory MongoDB, `helpers/` builds the test app | [README](backend/tests/README.md)       |
| `backend/docs/`        | `unitrace.postman_collection.json`, every route with a ready-to-send example                            | [Section 11](backend/README.md#11-postman-collection) |

Tests are grouped by domain like the source code. Run one kind with `npm test -- tests/unit` or `npm test -- tests/integration`. The per-file description of every test is in the tests README, so it is not repeated here.

Backend config files: `.env.example` (all variables), `eslint.config.js`, `.prettierrc`, `.prettierignore`, `vitest.config.js`, `package.json`.

---

## 7. Continuous integration

The workflow is [`.github/workflows/ci.yml`](.github/workflows/ci.yml), named **Backend CI**.

### When it runs

| Event               | Condition                                |
| ------------------- | ---------------------------------------- |
| `pull_request`      | Every pull request (no branch filter)    |
| `push`              | Only pushes to `main`                    |

A new push on the same branch cancels the run still in progress (`concurrency`). The token is read-only (`permissions: contents: read`).

### What it runs

Four independent jobs run in parallel, all inside `backend/`, all on `ubuntu-latest` with Node 24 and `npm ci`:

| Job (check name)    | Command                         | Fails when                                | Timeout |
| ------------------- | ------------------------------- | ----------------------------------------- | ------- |
| `Check formatting`  | `npm run format:check`          | A file is not formatted the Prettier way  | 10 min  |
| `Lint`              | `npm run lint`                  | ESLint reports an error                   | 10 min  |
| `Unit tests`        | `npm test -- tests/unit`        | A unit test fails                         | 10 min  |
| `Integration tests` | `npm test -- tests/integration` | An integration test fails                 | 15 min  |

The integration job also caches the `mongod` binary used by `mongodb-memory-server`, so only the first run downloads it.

### Run the same checks before you push

```bash
cd backend
npm run format:check   # npm run format fixes it
npm run lint
npm test -- tests/unit
npm test -- tests/integration
```

### Good to know

- CI covers the **backend**, which is the only code the workflow checks.
- To make a red run block merging, add a branch protection rule on `main` and require the four checks listed above.
- If you add a job or rename one, update the table above and the branch protection rule.

---

## 8. Keeping this documentation up to date

The project changes often, so the docs follow one rule: **the documentation changes in the same pull request as the code.**

| If you...                                  | Update                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Add, rename or delete a file in a layer    | That layer's `README.md` (one line per file) and its table in section 5 of this file            |
| Add a new layer or domain folder           | A `README.md` in it, a row in `backend/src/README.md`, a table in section 5 of this file        |
| Add or change a route                      | `backend/README.md` (API reference), `docs/unitrace.postman_collection.json`                    |
| Add or change an environment variable      | `.env.example`, `backend/README.md` section 3                                                   |
| Add or change an npm script                | `backend/README.md` section 4 and the command table in section 3 of this file                   |
| Add or rename a test file                  | `backend/tests/README.md`                                                                       |
| Change a CI job or trigger                 | Section 7 of this file and section 17 of `backend/README.md`                                    |
| Finish a missing feature                   | Remove it from `backend/README.md` section 21 and from the status note at the top of this file  |

Tips to keep the cost low:

- Do not write counts (number of tests, number of files) here. They go stale on the first commit.
- Link to a section instead of copying its content. This file should stay an index.
- Prettier checks Markdown in CI (`format:check`), so run `npm run format` after editing a README inside `backend/`.

---

## 9. License

Apache License 2.0. See [LICENSE](LICENSE).