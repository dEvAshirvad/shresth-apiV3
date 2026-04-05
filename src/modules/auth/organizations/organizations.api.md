# Organizations — API Reference

**Module:** Auth · **Mount:** `/api/v1/organization`

---

## Overview

Organization helpers: generating a human-readable **org code** before persistence, and switching the **active organization** on the current Better Auth session after membership is verified.

This file documents the routes on `organizations.router.ts` only. Other mounts under **`/api/v1/organization`** are documented separately (see below).

### Design decisions

1. **`generate-org-code` is probabilistic.** The server tries up to ten random suffixes against the `organization` collection; callers should retry on rare collision failures.
2. **`set-active-organization` is membership-gated.** The user must already be a `Member` of the target org; the session is updated server-side (not by trusting a client-supplied role).
3. **No Zod on these two routes** (today). Invalid or missing bodies surface as `APIError` from the service layer rather than request-shape validation middleware.

---

## Authentication & session

| Requirement | Detail |
| ----------- | ------ |
| Session | Better Auth populates `req.user` and `req.session` via global `sessions` middleware |
| `POST /set-active-organization` | Expects authenticated user + valid `organizationId` the user belongs to |
| `POST /generate-org-code` | Uses only `name` / `slug` from body; no org context required |

There is **no** separate role matrix enforced in these handlers beyond what `OrganizationsService` checks (membership for active org).

---

## HTTP envelope

Successful JSON responses use `Respond()`:

- `success`, `status`, `timestamp`, `data`, and usually `requestId`

Errors use `APIError` → `RespondError()`:

- `success: false`, `title`, `message`, `status` (HTTP code), optional `errors` (e.g. Zod flatten on other routes)

---

## Routes

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/v1/organization/generate-org-code` | Propose a unique `orgCode` string |
| `POST` | `/api/v1/organization/set-active-organization` | Set `activeOrganizationId` on session |

Other routers on the same prefix:

| Mount | Doc |
| ----- | --- |
| `/api/v1/organization/invitations` | [`../invitations/invitations.api.md`](../invitations/invitations.api.md) (bulk **admin** CSV/XLSX invites) |

---

## `POST /generate-org-code`

**Purpose:** Suggest a short code (e.g. three letters from name/slug + four digits) for UI before creating an organization in Better Auth / DB.

### Request body

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `name` | string | No* | Used for prefix (first 3 chars, uppercased) |
| `slug` | string | No* | Fallback prefix if `name` empty |

\*At least one of `name` or `slug` should be sent so the prefix is not always `ORG`.

### Responses

| HTTP | Meaning |
| ---- | ------- |
| 200 | `data` is the generated string (e.g. `"ABC1234"`) |
| 500 | Could not allocate a unique code after max attempts |

### Example

```json
// Request
{ "name": "Acme Trading Pvt Ltd" }

// Response 200 — shape via Respond()
{
  "success": true,
  "status": 200,
  "data": "ACM4821",
  "timestamp": "…",
  "requestId": "…"
}
```

---

## `POST /set-active-organization`

**Purpose:** Bind the current session to an organization the user is a member of.

### Request body

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `organizationId` | string (Mongo ObjectId) | Yes | Target organization |

### Responses

| HTTP | When |
| ---- | ---- |
| 200 | Session updated; `data` is service return (updated session payload) |
| 400 | Missing `organizationId` |
| 404 | No membership row for this user + org |

### Example

```json
// Request
{ "organizationId": "64fa1a2b3c4d5e6f708090a1" }

// Response 200
{
  "success": true,
  "status": 200,
  "data": { "…": "…" },
  "timestamp": "…",
  "requestId": "…"
}
```

---

## Error catalogue (this router)

| Title / scenario | Typical HTTP |
| ---------------- | ------------ |
| Organization ID is required | 400 |
| Member not found | 404 |
| Unable to generate unique organization code | 500 |

---

## Related code

- Router: `organizations.router.ts`
- Handler: `organizations.handler.ts`
- Service: `organizations.service.ts`
