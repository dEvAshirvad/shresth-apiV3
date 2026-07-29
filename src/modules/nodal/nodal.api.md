# Nodal API (org nodal candidates)

**Base path:** `/api/v1/nodal`

---

## What this module is

**Nodal records** are **organization-scoped** KPI officers stored in **`tb_nodals`**. Fields: **`name`**, **`phone`** (required), optional **`email`**, **`organizationId`**, optional **`empId`** (login username), **`userId`**, **`memberId`**, legacy **`invitationId`**, optional **`metadata`**.

### Preferred path (pseudo-users)

On **create** / **import** / **`POST /provision-credentials`**, the API:

1. Auto-generates **`empId`** (`{orgCode}_{NNNN}`)
2. Creates a Better Auth user (username = empId, synthetic email) with password
3. Adds org **member** with role **`nodal`**, sets **`isOnboarded: true`**
4. Returns plaintext credentials **once** (admin UI / CSV). **WhatsApp credential send is disabled** (provider 401).

Nodals sign in at the frontend **`/login`** with empId + password (no invitation / onboarding).

### Legacy path

**`POST /send-invitation-to-rest-nodals`** and **`POST /sync-from-org-members`** remain for older Google-invite flows. Prefer provision endpoints for new nodals.

Use **`POST /:id/reset-password`** to rotate a password (returns new password once; no WhatsApp).

---

## Auth and scope

- **`req.session.activeOrganizationId`** (valid ObjectId) is required for list/create/import/provision/reset and legacy invite/sync.
- List and create/import flows are **scoped to the active organization**.

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Paginated list for the **active org** + search (name/phone/email/empId). |
| `GET` | `/import/template` | Download CSV/XLSX import template. |
| `POST` | `/import` | Bulk upsert by **`phone`**; provisions credentials for new/unlinked rows; returns **`credentials[]`**. |
| `POST` | `/provision-credentials` | Provision empId + password for unlinked nodals in the active org. |
| `POST` | `/download-all-credentials` | **One-shot (fast):** rotate passwords for all org nodals — **no WhatsApp**. Returns slim rows `name,phone,email,empId,password` (or `?format=csv`). |
| `POST` | `/:id/reset-password` | Rotate password for one nodal; return credentials once. |
| `POST` | `/sync-from-org-members` | **Legacy.** Link user/member by email. |
| `POST` | `/send-invitation-to-rest-nodals` | **Legacy.** Email invitations (`role: nodal`). |
| `POST` | `/:email/attach-user-id-and-member-id` | Manual link (repair). |
| `GET` | `/am-i-assigned` | Current user mapped to nodal + department assignment. |
| `GET` | `/:id` | Get one. |
| `POST` | `/` | Create + provision credentials. |
| `PUT` | `/:id` | Update name/phone/email. |
| `DELETE` | `/:id` | Delete. |

Static paths (`/import/template`, `/import`, `/sync-from-org-members`, `/send-invitation-to-rest-nodals`, `/provision-credentials`, `/download-all-credentials`, `/am-i-assigned`) are registered before **`/:email/...`** and **`/:id`**.

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

Processes nodal rows in the **active organization** without **`userId`** (query **limit 500**). For each row with a valid **email**: creates pending invitations with **`role: 'nodal'`** or resends email for **pending** invitations (refreshing **`expiresAt`** / **`inviterId`** on resend); sets **`invitationId`** on new invites.

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
