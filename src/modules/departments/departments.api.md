# Departments API

**Base path:** `/api/v1/departments`

---

## What this module is

Departments are **org-scoped units** (name, slug, optional logo/metadata) used to group employees, KPI templates, and entries. Each department may have an **assigned nodal** (organization member) responsible for operational KPI work. Bulk **import** can set **`assignedNodal`** by providing the nodal’s **login email**; the API resolves **email → user → member id** for the active organization.

## Why it exists

Organizations split work by **department**; the KPI system needs a stable **foreign key** (`department` on employees, templates, entries) and a place to record **who leads** KPI collection (`assignedNodal`).

---

## Auth and scope

- Endpoints expect an authenticated session.
- **Reads and writes** filter or set data using `req.session.activeOrganizationId` (via handlers/services). If the session has no org, empty string may be passed to services—ensure the client always selects an active organization first.

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Paginated list with optional search. |
| `GET` | `/import/template` | Download CSV or XLSX import template. |
| `POST` | `/import` | Bulk upsert departments from CSV/XLSX (`multipart`). |
| `GET` | `/organization/statistics` | Aggregate department count for the org. |
| `GET` | `/:id` | Single department with populated nodal and org. |
| `POST` | `/` | Create department. |
| `PUT` | `/:id` | Update department fields. |
| `PATCH` | `/:id` | Assign or change `assignedNodal`. |
| `DELETE` | `/:id` | Delete department. |

Static paths (`import/template`, `import`, `organization/statistics`) are registered **before** `/:id` so they are not captured as ids.

---

## Shared response envelope

Success responses use the app’s standard JSON shape: `success`, `status`, `timestamp`, `cache`, `data`, optional `requestId`. Unless noted, **`data.message`** echoes a human-readable status string.

---

## `GET /api/v1/departments`

**Description (2 lines):** Returns a **paginated** list of departments in the active organization, with nested populate on `assignedNodal` → `userId` and `organizationId`. Supports **case-insensitive** search on `name` and `slug`.

### Request

- **Query**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page index. |
| `limit` | number | `10` | Page size. |
| `search` | string | `""` | Substring match on name/slug. |

### Success response

- **HTTP:** `200`
- **`data`:** `{ docs: Department[], total, page, limit, totalPages, hasNextPage, hasPreviousPage, message }`

---

## `GET /api/v1/departments/import/template`

**Description (2 lines):** Returns a **file download** (not JSON) so users can fill bulk import offline. Example row includes **`name`**, optional **`slug`**, and optional **`nodal_email`**.

### Request

- **Query:** `format` — `csv` (default) or `xlsx`.

### Success response

- **HTTP:** `200`
- **Headers:** `Content-Type` (`text/csv` or Excel MIME), `Content-Disposition` attachment filename `departments-import-template.csv` or `.xlsx`.
- **Body:** File bytes — header row includes `name,slug,nodal_email` (CSV) or equivalent columns (XLSX).

---

## `POST /api/v1/departments/import`

**Description (2 lines):** Accepts **multipart** upload field **`file`** (`.csv` or `.xlsx`). Rows are normalized and **upserted** by **`slug` + `organizationId`** (`slug` is derived from `name` when omitted). Optional **nodal** columns set **`assignedNodal`** when the email resolves to a **member** of the active organization.

### Request

- **Content-Type:** `multipart/form-data`
- **Field:** `file` — CSV or XLSX.

### Columns (header row)

| Column | Required | Description |
|--------|----------|-------------|
| `name` | Yes | Department display name. |
| `slug` | No | Stable key for upsert; if empty, derived from `name` (slugify). |
| `nodal_email` | No | Login email of an org **member** to assign as nodal. Same logical column is accepted under aliases (case-insensitive headers): `assigned_nodal_email`, `assignednodalemail`, or `nodal email` (e.g. Excel). |

If **`nodal_email`** is omitted or empty for a row, **`assignedNodal`** is not changed on update (existing assignment kept). If provided and the email cannot be resolved to a member in this org, the department row is still upserted; details appear in **`nodalAssignmentErrors`**.

### Success response

- **HTTP:** `200`
- **`data`:**  
  `{ insertedCount: number, updatedCount: number, totalProcessed: number, nodalAssignmentErrors: NodalImportError[], message }`  
  - **`nodalAssignmentErrors`:** array of `{ slug: string, email: string, reason: string }` for rows where a nodal email was supplied but no member matched (unknown user or not in org). Empty array when there are no such failures.

### Error responses (non-throwing)

| HTTP | `data.message` (typical) |
|------|---------------------------|
| 400 | Missing file, empty Excel, unsupported extension, or no valid rows. |

---

## `GET /api/v1/departments/organization/statistics`

**Description (2 lines):** Runs a lightweight **aggregation** counting departments for the active organization. Used for dashboards or org overview.

### Request

- None.

### Success response

- **HTTP:** `200`
- **`data`:** `{ stats: Array<{ _id: unknown, count: number }>, message }`  
  Shape follows Mongo `$group` output (typically one element with total count).

---

## `GET /api/v1/departments/:id`

**Description (2 lines):** Loads one department **scoped to the organization** and populates `assignedNodal` (with `userId`) and `organizationId`. Returns **404** JSON if not found or wrong org.

### Request

- **Params:** `id` — department ObjectId string.

### Success response

- **HTTP:** `200`
- **`data`:** `{ department: object, message }`

### Not found

- **HTTP:** `404` — `{ message: 'Department not found' }` (standard envelope).

---

## `POST /api/v1/departments`

**Description (2 lines):** Creates a department; **`organizationId` is taken from the session**, not from the client body schema. Slug must be unique per deployment rules enforced in the model.

### Request

- **Body (`zDepartmentCreate`):** `name` (string, min 1), `slug` (string, min 1), `logo?`, `metadata?`

### Success response

- **HTTP:** `201`
- **`data`:** `{ department: createdDoc, message }`

### Errors

| Status | When |
|--------|------|
| 400 | `VALIDATION_ERROR` — Zod body validation failed. |

---

## `PUT /api/v1/departments/:id`

**Description (2 lines):** Partial-friendly update via **`zDepartmentUpdate`** (all fields optional). Only documents matching **`_id` + organization** are updated.

### Request

- **Params:** `id`
- **Body:** optional `name`, `slug`, `logo`, `metadata`

### Success response

- **HTTP:** `200` — `{ department, message }`  
- **HTTP:** `404` — not found

---

## `PATCH /api/v1/departments/:id`

**Description (2 lines):** Sets **`assignedNodal`** to a **member** ObjectId for this department. Use this after the nodal accepts an org invite and has a member record. Alternatively, bulk **`POST /import`** can set the same field using **`nodal_email`** (see import section).

### Request

- **Params:** `id`
- **Body (`zDepartmentAssignNodal`):** `{ "assignedNodal": "<ObjectId string>" }`

### Success response

- **HTTP:** `200` — `{ department, message: 'Nodal assigned successfully' }`  
  Response document is **lean** (no populate in current service).

### Errors

| Status | When |
|--------|------|
| 400 | `VALIDATION_ERROR` |

---

## `DELETE /api/v1/departments/:id`

**Description (2 lines):** Deletes a department **if it belongs to the active organization**. Returns the deleted document on success.

### Request

- **Params:** `id`

### Success response

- **HTTP:** `200` — `{ department, message }`
- **HTTP:** `404` — not found

---

## Related

- **Employees** reference `department` ObjectId.
- **KPI templates / entries** reference departments where applicable.
- **Organization invitations** (`/api/v1/organization/invitations/import`) — bulk invite **org admins** only (`role: admin` in file; session **owner** or **org admin**). **Nodal** users are invited via **`/api/v1/nodal`**. Invitees become **members** so `nodal_email` department import can resolve them.
