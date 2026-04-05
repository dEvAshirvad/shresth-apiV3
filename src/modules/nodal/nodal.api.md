# Nodal API (org nodal candidates)

**Base path:** `/api/v1/nodal`

---

## What this module is

**Nodal records** are **organization-scoped** candidates for KPI users who should join as **nodals** (not line staff). Stored in **`tb_nodals`**, with fields: **`name`**, **`phone`** (required), optional **`email`**, **`organizationId`**, optional **`userId`**, **`memberId`**, **`invitationId`**, optional **`metadata`**. There are **no** department / `departmentRole` fields on the nodal model (unlike older parallel designs).

Use **`POST /send-invitation-to-rest-nodals`** to create or resend invitations with **`role: 'nodal'`** and set **`invitationId`**. Use **`POST /sync-from-org-members`** to backfill **`userId`** / **`memberId`** from Better Auth **user** + **member** by **email** for all nodal rows in the active org. Use **`POST /:email/attach-user-id-and-member-id`** to set **`userId`** and **`memberId`** manually when you already know both ids (path **`email`** must match the nodal row; URL-encode the address).

## Difference from Employee API

When invitations are sent, new rows use **`role: 'nodal'`** on the **invitation** document (employees use **`staff`**). After acceptance, the org **member** has the **nodal** role instead of **staff**.

---

## Why it exists

CRUD, bulk import by phone within an org, bulk send invitations, sync user/member from email, and manual attach — same product flows as **employees**, but for **nodal** org membership.

---

## Auth and scope

- **`req.session.activeOrganizationId`** (valid ObjectId) is required for **`GET /`**, **`POST /`** (create), **`POST /import`**, **`POST /sync-from-org-members`**, and **`POST /send-invitation-to-rest-nodals`**.
- List and create/import flows are **scoped to the active organization** (`organizationId` on documents).
- **`send-invitation-to-rest-nodals`** also requires an authenticated **`req.user`** (inviter) and uses the **`Origin`** request header for invitation links when applicable.

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Paginated list for the **active org** + search. |
| `GET` | `/import/template` | Download CSV/XLSX import template. |
| `POST` | `/import` | Bulk upsert by **`phone`** within the active org (`multipart` file; no department in body). |
| `POST` | `/sync-from-org-members` | For **all** nodals in the active org: match **email → user → member**; set `userId` + `memberId` where missing. **No body.** Returns **`202`** + **`jobId`** when work is queued (BullMQ); **`200`** + sync result when **`BACKGROUND_JOBS_SYNC=true`**. |
| `GET` | `/am-i-assigned` | Check whether the logged-in user is linked to a nodal row and assigned to any department. |
| `POST` | `/:email/attach-user-id-and-member-id` | Set **`userId`** and **`memberId`** on the nodal whose **`email`** matches the path segment. |
| `GET` | `/:id` | Single nodal by Mongo **`_id`** (populated fields where applicable). |
| `POST` | `/` | Create nodal in the active org. |
| `PUT` | `/:id` | Update nodal. |
| `DELETE` | `/:id` | Delete nodal. |
| `POST` | `/send-invitation-to-rest-nodals` | Create/resend invitations (**nodal** role) for nodals in the org without **`userId`**. **No body.** Returns **`202`** + **`jobId`** when queued; **`200`** with **`nodals`** / **`errors`** when **`BACKGROUND_JOBS_SYNC=true`**. Poll **`GET /api/v1/jobs/:jobId`** for queued results. |

Static paths (`/import/template`, `/import`, `/sync-from-org-members`, `/send-invitation-to-rest-nodals`, `/am-i-assigned`) are registered before **`/:email/attach-user-id-and-member-id`** and **`/:id`** so they are not interpreted as ids or emails.

---

## `GET /api/v1/nodal`

Requires **`activeOrganizationId`**. Paginated nodal documents for that org with **`invitationId`** and **`userId`** populated.

**Query:** `page`, `limit`, `search` (matches name, email, or phone, case-insensitive).

**Response shape:** `docs`, `total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPreviousPage`, `message`.

---

## `GET /api/v1/nodal/import/template`

File download. Template columns: **`name`**, **`phone`**, **`email`** (optional column in file).

**Query:** `format` — `csv` (default) or `xlsx`.

---

## `POST /api/v1/nodal/import`

**Multipart** field **`file`** (CSV or XLSX). Rows require at least **`name`** and **`phone`** per row; optional **`email`**. Requires **`activeOrganizationId`**. Upserts by **`phone`** + **`organizationId`** (no `departmentId`).

**Response:** `insertedCount`, `updatedCount`, `totalProcessed`, `message`.

---

## `GET /api/v1/nodal/:id` | `POST /` | `PUT /:id` | `DELETE /:id`

- **`POST /`** — Body validated with **`nodalDepartmentCreateZodSchema`**: **`name`**, **`phone`**, optional **`email`**. **`organizationId`** is taken from the session, not required in the body.
- **`PUT /:id`** — Partial update: **`name`**, **`email`**, **`phone`** (**`nodalDepartmentUpdateZodSchema`**).

Success responses include **`nodal`** and **`message`**. **`404`** if not found for get/update/delete.

---

## `POST /api/v1/nodal/:email/attach-user-id-and-member-id`

**Path:** `:email` — the nodal’s email (URL-encode **`@`** and other special characters).

**Body:** **`attachUserIdMemberIdZodSchema`**: `{ "userId": "<ObjectId>", "memberId": "<ObjectId>" }`.

Success: **`{ nodal, message }`** (`200`).

### Errors

| `TITLE` | HTTP |
|---------|------|
| `INVALID_IDS` | 400 |
| `NODAL_NOT_FOUND` | 404 |

---

## `POST /api/v1/nodal/sync-from-org-members`

**No request body.** Uses **`activeOrganizationId`** only. Walks nodal rows for that org and links **`userId`** / **`memberId`** when email resolves to a user who is a member of that org.

**Response:** **`linked`**, **`skipped`** (entries with **`nodalId`**, optional **`email`**, **`reason`**), **`message`**.

### Errors

| `TITLE` | HTTP |
|---------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 |
| `INVALID_ORGANIZATION_ID` | 400 (service; invalid session org id) |

---

## `GET /api/v1/nodal/am-i-assigned`

Checks whether the current authenticated user (`req.user.id`) is:

1. Linked to a nodal row (`tb_nodals.userId`)
2. Assigned as nodal in at least one department (`tbl_departments.assignedNodal === nodal.memberId`)

Current handler behavior is **always `200`** for assignment checks (business negatives are returned in payload, not thrown as API errors).

**Response patterns (`200`):**

- Assigned: nodal object fields are returned directly (spread from service result).
- Not assigned / not mapped: `{ isAssigned: false, message: "..." }`

The message may include a fallback admin/owner email when available for support guidance.

---

## `POST /api/v1/nodal/send-invitation-to-rest-nodals`

**No body.** Requires **`activeOrganizationId`**, authenticated **`req.user`** (inviter), and a usable **`Origin`** (or equivalent) for building invitation links when the invitee has no account yet.

Processes nodal rows in the **active organization** without **`userId`** (query **limit 500**). For each row with a valid **email**: creates pending invitations with **`role: 'nodal'`** or resends email for **pending** invitations; sets **`invitationId`** on new invites.

**Response:**

```json
{
  "nodals": [{ "id": "", "name": "", "email": "", "phone": "" }],
  "errors": [{ "nodalId": "", "email": "", "message": "" }],
  "message": "..."
}
```

### Errors

| `TITLE` | HTTP |
|---------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 |
| `INVITER_REQUIRED` | 401 |

When org metadata or mail configuration is incomplete, per-row **`errors`** may describe the failure (e.g. missing org name, inviter email, or frontend base URL).

---

## Related

- **`/api/v1/employee`** — staff-line KPI users; invitations use **`staff`**.
- **`/api/v1/organization/invitations/import`** — bulk CSV **org admin** invites (`role: admin`). **Nodal** org invites use **`send-invitation-to-rest-nodals`**, not that bulk import.
