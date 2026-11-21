# Admin API

Reference for the administration, moderation and statistics endpoints. Every route here is under `/api/v1` and needs a logged-in admin account, except where stated. Regular users are refused with `403 FORBIDDEN`, and missing or invalid tokens get `401 UNAUTHENTICATED`.

Errors use the shared format:

```json
{ "error": { "code": "CONFLICT", "message": "...", "details": [] } }
```

## Who can do what

| Action                               | Regular user                              | Admin |
| ------------------------------------ | ----------------------------------------- | ----- |
| Flag a declaration (`POST /reports`) | yes, not their own, once per declaration  | yes   |
| See and treat reports                | no                                        | yes   |
| Hide, restore, delete a declaration  | no (the owner can still delete their own) | yes   |
| List users, delete a user            | no                                        | yes   |
| Statistics                           | no                                        | yes   |

Admins cannot delete their own account or another admin's account.

## Reports

### Flag a declaration

`POST /api/v1/reports` (any logged-in user)

```json
{ "declarationId": "6a...", "reason": "duplicate", "comment": "optional, max 500" }
```

`reason` is one of `false_declaration`, `inappropriate_content`, `duplicate`, `incorrect_information`, `other`.

- `201` with the report
- `403` if you report your own declaration
- `404` if the declaration does not exist or is deleted
- `409` if you already have an open report on it

### List open reports

`GET /api/v1/admin/reports?page=1&limit=20` (admin). Oldest first. Maximum `limit` is 50.

### Treat a report

`PATCH /api/v1/admin/reports/:id` (admin)

```json
{ "status": "treated", "resolution": "optional, 3 to 500 characters" }
```

`status` is `treated` or `dismissed`. Returns `200`, `409` if the report is already closed, `404` if unknown.

## Declaration moderation

Each action needs a `reason` of at least 3 characters. The reason is stored in the audit log.

| Route                                         | Effect                                                    | Success |
| --------------------------------------------- | --------------------------------------------------------- | ------- |
| `POST /api/v1/admin/declarations/:id/hide`    | hides it from everyone except the owner and admins        | `200`   |
| `POST /api/v1/admin/declarations/:id/restore` | restores a hidden declaration to the status it had before | `200`   |
| `DELETE /api/v1/admin/declarations/:id`       | deletes it and clears its private information             | `204`   |

Body for all three: `{ "reason": "Looks like a fake listing" }`

Errors: `400` for a missing or short reason, `404` for an unknown declaration, `409` for a move that is not allowed (for example hiding a hidden declaration, or restoring one that is not hidden).

## Users

### List users

`GET /api/v1/admin/users?page=1&limit=20` (admin). Returns username, email, role and dates. Passwords are never returned.

### Delete a user

`DELETE /api/v1/admin/users/:id` (admin)

```json
{ "reason": "Repeated spam" }
```

The account is anonymized, its sessions are revoked, and its declarations are cleaned up. This is permanent. Returns `204`.

Errors: `409` when trying to delete yourself or another admin, `404` for an unknown or already deleted user.

## Statistics

`GET /api/v1/admin/stats?from=2026-11-01T00:00:00Z&to=2026-11-10T00:00:00Z` (admin)

- Without `from` and `to`, the last 30 days are used. The range can be at most 366 days.
- Totals (users, declarations, reports) are current and not limited by the range.
- `timeline` lists the declarations created per day within the range.
- `matches` and `recovered` count declarations in the `matched` and `resolved` statuses.

Errors: `400` if `from` is after `to`, if the range is too long, or if a date is not ISO.

## Audit log

Every admin action writes one line: who did it, what, which target, the reason and the time. The log is append-only and is not exposed by an endpoint yet.
