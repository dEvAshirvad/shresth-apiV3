# Organization invitations (bulk org admin) API

**Base path:** `/api/v1/organization/invitations`

This module complements **Better Auth’s** organization invitation flow with a **bulk CSV/XLSX import** that creates rows in the app’s **`invitation`** collection and sends the same **organization invitation email** used elsewhere.

**Nodal invites** are **not** included here: use **`/api/v1/nodal`** (import + **`send-invitation-to-rest-nodals`**) so invitations use role **`nodal`**. This import is only for inviting **organization admins** (`role: admin` in the file).

---

## What this module is

- **`GET /`** — List invitations for the active organization with pagination, sort, and optional filter (same query shape as Better Auth **list-members**; **owner** or **org admin** only).
- **`GET /import/template`** — Download a CSV or XLSX template with columns **`email`** and **`role`** ( **`role` must be `admin`** ) (**owner** or **org admin** only).
- **`POST /import`** — Upload a filled file: each row creates or updates a **pending** invitation with org role **`admin`** only, then sends emails (**owner** or **org admin** only).

Invitations are stored in MongoDB (`collection: invitation`).

---

## Why it exists

Organization **owners** and **admins** need to invite **multiple org admins** from a spreadsheet. **Nodal** onboarding is handled via the **nodal** API and department flows. The service resolves **duplicate emails**, **existing members**, and **pending invites** (resend + refresh expiry) consistently.

---

## Auth and scope

| Concern | Behavior |
|---------|----------|
| Session | **`GET /`**, **`GET /import/template`**, and **`POST /import`** require **`requireOrgOwnerOrAdmin`**: active organization in session and org role **`owner`** or **`admin`**. **Nodal** and **staff** receive **403**. |
| Organization | **`organizationId`** is taken from **`req.session.activeOrganizationId`**. |
| Inviter | The signed-in user is **`inviterId`** on new invitation rows. |

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | List invitations for the active org (pagination, sort, optional filter; owner/admin only). |
| `GET` | `/import/template` | Download CSV or XLSX import template (**admin** role column only; owner/admin only). |
| `POST` | `/import` | Bulk import: create/resend **admin** invitations and send emails (`multipart`, owner/admin only). |

---

## Shared response envelope

Success responses use the standard JSON shape: `success`, `status`, `timestamp` (UTC), `cache`, `data`, optional `requestId`. Unless noted, **`data.message`** summarizes the outcome.

---

## `GET /api/v1/organization/invitations`

**Description:** Returns a **paginated** list of invitation documents for **`req.session.activeOrganizationId`**. Query options mirror Better Auth’s **organization list-members** API (limit, offset, sort, single-field filter). Requires **owner** or **org admin**.

### Request

**Query parameters (all optional except as noted):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Maximum number of invitations to return. **Default:** `20`. **Maximum:** `100`. |
| `offset` | number | Number of invitations to skip before returning results. **Default:** `0`. |
| `sortBy` | string | Field to sort by. Allowed: **`email`**, **`inviterId`**, **`role`**, **`status`**, **`expiresAt`**, **`createdAt`**. **Default:** `createdAt`. |
| `sortDirection` | `"asc"` \| `"desc"` | Sort order. **Default:** `desc`. |
| `filterField` | string | Field to filter on (same allowed values as **`sortBy`**). If set, **`filterValue`** is required. |
| `filterOperator` | `"eq"` \| `"ne"` \| `"lt"` \| `"lte"` \| `"gt"` \| `"gte"` \| `"in"` \| `"not_in"` \| `"contains"` \| `"starts_with"` \| `"ends_with"` | How to compare **`filterValue`** to **`filterField`**. **Default:** `eq` when **`filterField`** is present. |
| `filterValue` | string \| number \| boolean \| string[] \| number[] | Value to filter by. For `in` / `not_in`, pass a **JSON array** (URL-encoded), e.g. `filterValue=%5B%22pending%22%2C%22accepted%22%5D`. For dates (**`expiresAt`**, **`createdAt`**), use an ISO-8601 string or Unix ms. For **`inviterId`**, use a MongoDB ObjectId string (or array of strings for `in` / `not_in`). |

**Filter behavior by field kind:**

- **`email`**, **`role`**, **`status`**: string operators; **`email`** matching is case-insensitive for equality-style filters.
- **`inviterId`**: only **`eq`**, **`ne`**, **`in`**, **`not_in`** (ObjectId values).
- **`expiresAt`**, **`createdAt`**: comparison operators and **`in`** / **`not_in`** (date values); **`contains`** / **`starts_with`** / **`ends_with`** are not valid for date fields.

### Success response

- **HTTP:** `200`
- **`data`** includes:

| Field | Type | Description |
|-------|------|-------------|
| `invitations` | array | Raw invitation documents (Mongo fields such as `_id`, `email`, `inviterId`, `organizationId`, `role`, `status`, `expiresAt`, `createdAt`). |
| `total` | number | Count of invitations matching the org scope + filter (ignores limit/offset). |
| `limit` | number | Applied page size (after clamping to max 100). |
| `offset` | number | Applied skip. |
| `message` | string | e.g. `Invitations listed`. |

### Errors (thrown)

| Status | When |
|--------|------|
| `400` | `NO_ACTIVE_ORGANIZATION` — no active org in session (non-throwing handler message for missing session). |
| `400` | `INVALID_ORGANIZATION_ID` — invalid org id in session. |
| `400` | `INVALID_SORT_FIELD` — **`sortBy`** not in the allowed list. |
| `400` | `INVALID_FILTER_FIELD` / `INVALID_FILTER_OPERATOR` / `INVALID_FILTER` / `INVALID_FILTER_VALUE` / `UNSUPPORTED_FILTER` — bad filter combination or value. |
| `403` | `ORG_OWNER_OR_ADMIN_REQUIRED` — caller is not owner or admin. |

---

## `GET /api/v1/organization/invitations/import/template`

**Description:** Returns a **file download** (not JSON) with one example row: **`admin@example.com`**, **`admin`**. Requires the same session as **`POST /import`** (owner or org admin).

### Request

- **Query:** `format` — `csv` (default) or `xlsx`.

### Success response

- **HTTP:** `200`
- **Headers:** `Content-Type` (`text/csv` or Excel MIME), `Content-Disposition` attachment filename `admin-invitations-import-template.csv` or `.xlsx`.
- **Body:** File bytes — header `email,role` (CSV).

### Errors (thrown)

| Status | When |
|--------|------|
| 400 | `NO_ACTIVE_ORGANIZATION` — no active org in session. |
| 403 | `ORG_OWNER_OR_ADMIN_REQUIRED` — caller is not owner or admin. |

---

## `POST /api/v1/organization/invitations/import`

**Description:** Accepts **`multipart/form-data`** with field **`file`** (`.csv` or `.xlsx`). Each data row must include **`email`** and **`role`**. Only **`admin`** is accepted in the **`role`** column (case-insensitive). Sends invitation emails using the request **`Origin`** header for invite links (same pattern as employee invitation sends).

### Request

- **Content-Type:** `multipart/form-data`
- **Field:** `file` — CSV or XLSX.
- **Headers:** **`Origin`** should be set to your frontend base URL (e.g. `http://localhost:3002`) so invitation links are built correctly. If missing, the service treats the run as misconfigured and surfaces errors.

### Columns (header row)

| Column | Required | Description |
|--------|----------|-------------|
| `email` | Yes | Invite address; normalized to lowercase for storage. |
| `role` | Yes | Must be **`admin`** (invited member’s org role when they accept). |

### Processing rules (summary)

- **Already an org member** (user exists and **`member`** row for this org): row is listed in **`skipped`** (`already_member`); no email.
- **Invitation already accepted** for that email + org: **`skipped`** (`invitation_already_accepted`).
- **Duplicate email** in the same file: first occurrence is processed; later rows **`skipped`** (`duplicate_email_in_file`).
- **Pending invitation** already exists for that email + org: invitation is **updated** (`expiresAt` refreshed, **`role`** updated), email **resent**; counts toward **`resent`**.
- **New invitation:** inserted with status **`pending`**, expiry **7 days** from creation, then email sent; counts toward **`created`** if the email succeeds.
- If sending email fails for a **newly created** invitation, that invitation document is **deleted** (rollback); the address appears in **`emailFailures`**.

### Success response

- **HTTP:** `200`
- **`data`** (shape):

| Field | Type | Description |
|-------|------|-------------|
| `created` | number | New invitations persisted and email reported successful (after rollbacks). |
| `resent` | number | Pending invitations updated and resend attempted. |
| `skipped` | `Array<{ email, reason }>` | See skip reasons above. |
| `errors` | `Array<{ row?, email?, message }>` | Per-row validation failures (invalid email, **`role`** not **`admin`**, etc.). |
| `emailFailures` | `Array<{ email, message }>` | SMTP / template failures for specific addresses. |
| `totalProcessed` | number | Rows parsed after normalization. |
| `message` | string | Short summary; if every email failed for new invites, message directs you to **`emailFailures`**. |

### Errors (thrown)

| Status | When |
|--------|------|
| `401` | `INVITER_REQUIRED` — no authenticated user (service guard). |
| `400` | `NO_ACTIVE_ORGANIZATION` / `INVALID_ORGANIZATION_ID` (service). |
| `403` | `ORG_OWNER_OR_ADMIN_REQUIRED` — caller is not owner or admin (middleware). |

### Non-throwing client errors

| HTTP | Typical `data.message` |
|------|---------------------------|
| 400 | Missing file, empty Excel, unsupported extension, no active org in session, or no valid rows. |

---

## Data model (reference)

Invitation documents (see `invitations.model.ts`) include **`email`**, **`inviterId`**, **`organizationId`**, **`role`**, **`status`** (`pending` \| `accepted` \| …), **`expiresAt`**. Better Auth may also manage invitations; this bulk API writes compatible rows used by the app’s mailer and acceptance flows.

---

## Related

- **`/api/v1/nodal`** — Import nodal candidates (org-scoped by phone); **`POST /send-invitation-to-rest-nodals`** sends **`nodal`** role invitations (**no** request body; org-wide batch). See **`nodal.api.md`**.
- **`/api/v1/departments`** — After invitees accept, they appear as **members**; department import can assign **`nodal_email`** to departments.
- **Employee** — **`POST /send-invitation-to-rest-employees`** with **`departmentId`** uses **`staff`** role on invitations and the same **`sendOrganizationInvitationEmail`** helper.
