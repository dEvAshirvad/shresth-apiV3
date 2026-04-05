# KPI Templates API

**Base path:** `/api/v1/templates`

---

## What this module is

A **KPI template** is a reusable scoring definition for one **role** (optionally scoped to a **department**). It contains:

- Identity: **`name`**, optional **`description`**, **`role`**, optional **`departmentId`**, **`organizationId`**.
- **`items[]`**: one or more KPI line items. Each item has a **`title`**, optional **`description`**, **`inputType`**, optional **`unit`** (not for percent), **`maxMarks`**, **`judgement`** (how raw input becomes **awarded marks**), and **`isActive`**.

**Entries** (draft/submit and bulk import) reference a template by **`templateId`**. At upsert time the server **snapshots** item definitions and computes **`awardedMarks`** per item using the same rules documented below. That keeps scores stable if the template is edited later.

---

## Why it exists

- **One source of truth** for how each KPI is measured and scored (`percent`, slabs, boolean, range).
- **Validation before save**: a template’s **`role`** must match at least one employee’s **`departmentRole`** in the chosen department (case-insensitive), so you do not define templates for roles that do not exist in data.
- **Imports and forms** can rely on a fixed structure: item `_id`s in Mongo become stable keys for CSV columns and APIs.

---

## Auth and scope

- Handlers use **`req.session.activeOrganizationId`** for all reads and writes.
- If the session has **no** active organization, `organizationId` becomes **`''`** and list/get may return empty results or 404; clients should ensure the user has selected an org.
- **`POST` / `PUT`**: **`organizationId` in the JSON body is required by Zod** (`zKpiTemplateCreate`). The service **overwrites** it with the session org when persisting—send the same value as the active org id (or any placeholder your client uses); the server does not trust a different org id in the body.

---

## Data model (conceptual)

### Template (`kpi_templates` collection)

| Field | Type | Required | Notes |
|-------|------|------------|--------|
| `_id` | ObjectId | auto | Template id; used as `templateId` on entries. |
| `organizationId` | ObjectId | yes | Always the active org from session on create. |
| `departmentId` | ObjectId | no | If set, template is department-specific; **create** validation still requires a real department id that passes `validateRoleInDepartment` (see below). |
| `role` | string | yes | Logical role label (e.g. `"SDM"`). Must match an employee `departmentRole` in that department (case-insensitive). |
| `name` | string | yes | Display name for lists and UIs. |
| `description` | string | no | |
| `items` | array | yes | Min **1** item; each subdocument matches item schema below. |
| `createdAt` / `updatedAt` | date | auto | |

### Item (embedded in `items[]`)

| Field | Type | Required | Notes |
|-------|------|------------|--------|
| `_id` | ObjectId | auto | Stable id used when storing entry line items and import columns. |
| `title` | string | yes | Min length 1. |
| `description` | string | no | |
| `inputType` | enum | yes (default) | **`number`** \| **`percent`** \| **`boolean`**. Must agree with `judgement.type` (see pairing rules). |
| `unit` | string | no | Display only for **number** KPIs (e.g. `"visits"`, `"₹"`). **Omit** for **`percent`** (forbidden by validation). |
| `maxMarks` | number | yes | **Must be &gt; 0** (Zod `.positive()`). Caps awarded marks for this line. |
| `judgement` | object | yes | Discriminated union on **`type`**: `percent` \| `target` \| `boolean` \| `range`. |
| `isActive` | boolean | default `true` | Reserved for soft-disable in UIs; server still stores it. |

### `judgement` shapes (Zod: `zKpiJudgement`)

#### `type: "percent"`

| Field | Type | Notes |
|-------|------|--------|
| `type` | `"percent"` | |
| `mode` | `"linear"` (default) | Only value supported. |

**Pairing:** `inputType` **must** be **`percent`**.

**`unit`:** Do **not** send **`unit`** on percent items. Validation rejects non-empty `unit`; the UI/backend always treat the value as **percent (0–100)**.

**Scoring (entries service):** input is treated as a percentage **0–100** (clamped).  
`awardedMarks = clamp(maxMarks * (pct / 100), 0, maxMarks)`.

#### `type: "target"`

| Field | Type | Notes |
|-------|------|--------|
| `type` | `"target"` | |
| `slabs` | array | Min **1** entry: `{ target: number (≥0), marks: number (≥0) }`. |
| `mode` | `"best_match"` (default) \| `"nearest"` | How to pick a slab from achieved value. |

**Pairing:** `inputType` **must** be **`number`**.

**Scoring:**

- **`best_match`:** sort slabs by **`target` descending**; pick the first slab where **`achieved >= target`**. If none, **0** marks. Then clamp result to `[0, maxMarks]`.
- **`nearest`:** pick the slab whose **`target`** has the smallest absolute distance to **`achieved`**; use that slab’s **`marks`**, then clamp to `[0, maxMarks]`.

Recommendation: for `best_match`, define slabs with **highest `target` first** so intent is obvious; the runtime sorts anyway.

#### `type: "boolean"`

| Field | Type | Notes |
|-------|------|--------|
| `type` | `"boolean"` | Only this field is required on the judgement object. |

**Pairing:** `inputType` **must** be **`boolean`**.

**Scoring:** **`true`** → full **`maxMarks`** on the item; **`false`** → **0**. There is no separate `trueMarks` (avoids mismatch with `maxMarks`).

#### `type: "range"`

| Field | Type | Notes |
|-------|------|--------|
| `type` | `"range"` | |
| `ranges` | array (min 1) | Each entry: `{ min, max, marks }` with **`min` ≤ `max`** (inclusive band). |

**Pairing:** `inputType` **must** be **`number`**.

**Scoring:** Walk **`ranges` in array order**; the **first** band where `min ≤ achieved ≤ max` wins: `awardedMarks = clamp(band.marks, 0, maxMarks)`. If no band matches → **0**. Non-finite input → **0**.

Legacy templates may still have a single top-level `min` / `max` / `marks` on the judgement; the server supports that for old rows, but new templates should use **`ranges`** only.

---

## `inputType` ↔ `judgement.type` pairing (mandatory)

| `judgement.type` | Required `inputType` |
|-------------------|----------------------|
| `percent` | `percent` |
| `target` | `number` |
| `boolean` | `boolean` |
| `range` | `number` |

Violations are **`VALIDATION_ERROR`** from Zod (`superRefine` on `zKpiItem`), with paths under the item (e.g. `items[0].inputType`).

---

## Business rule: `validateRoleInDepartment`

On **create**, and on **update** when the resolved **`departmentId`** and **`role`** are both non-empty:

1. **`departmentId`** must exist → else **`INVALID_DEPARTMENT`** (400).
2. At least one **employee** must have **`department`** = that id and **`departmentRole`** matching **`role`** with a **case-insensitive** regex anchored to the full string → else **`INVALID_ROLE_FOR_DEPARTMENT`** (400).

**Create path:** the service calls `validateRoleInDepartment(template.departmentId || '', template.role || '')`. If **`departmentId`** is missing or empty, department lookup fails → treat **`departmentId` as required in practice** for successful creation.

**Update path:** merged `departmentId` / `role` from patch + existing document; validation runs only if **`nextDepartmentId && nextRole`** are both truthy.

---

## How to create a template correctly (checklist)

1. **Org session:** User has **`activeOrganizationId`** set (same as other KPI APIs).
2. **Department:** Choose a real **`departmentId`** (ObjectId string) in that org.
3. **Role:** Pick **`role`** exactly as employees use it in **`departmentRole`** (spacing/case can differ; match is case-insensitive).
4. **Employees:** Ensure **≥1 employee** in that department has that **`departmentRole`** before calling **`POST /templates`**.
5. **Body:** Include **`organizationId`** in JSON (must satisfy Zod; server replaces with session org).
6. **Items:** At least one item; each **`maxMarks` &gt; 0**; each **`judgement`** matches one of the four types and **`inputType`** matches the pairing table.
7. **Optional:** `description`, **`unit`** (only for **number** KPIs—not percent), `isActive` on items.

---

## Example payloads

### Minimal `percent` item

```json
{
  "organizationId": "ORG_ID_FROM_SESSION",
  "departmentId": "DEPT_ID",
  "role": "SDM",
  "name": "Q1 Sales KPI",
  "description": "Optional",
  "items": [
    {
      "title": "Revenue attainment",
      "inputType": "percent",
      "maxMarks": 50,
      "judgement": { "type": "percent", "mode": "linear" },
      "isActive": true
    }
  ]
}
```

### `target` with `best_match` slabs

```json
{
  "organizationId": "ORG_ID_FROM_SESSION",
  "departmentId": "DEPT_ID",
  "role": "SDM",
  "name": "Visits KPI",
  "items": [
    {
      "title": "Field visits",
      "inputType": "number",
      "unit": "visits",
      "maxMarks": 30,
      "judgement": {
        "type": "target",
        "mode": "best_match",
        "slabs": [
          { "target": 20, "marks": 30 },
          { "target": 10, "marks": 15 },
          { "target": 5, "marks": 5 }
        ]
      }
    }
  ]
}
```

### `boolean` + `range`

```json
{
  "organizationId": "ORG_ID_FROM_SESSION",
  "departmentId": "DEPT_ID",
  "role": "Analyst",
  "name": "Compliance",
  "items": [
    {
      "title": "Training completed",
      "inputType": "boolean",
      "maxMarks": 10,
      "judgement": { "type": "boolean" }
    },
    {
      "title": "Audit score band",
      "inputType": "number",
      "maxMarks": 20,
      "judgement": {
        "type": "range",
        "ranges": [
          { "min": 90, "max": 100, "marks": 20 },
          { "min": 80, "max": 89.99, "marks": 15 },
          { "min": 0, "max": 79.99, "marks": 5 }
        ]
      }
    }
  ]
}
```

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Paginated list; optional `search`, `departmentId`, `role`. |
| `GET` | `/:id` | Single template by id (org-scoped). |
| `POST` | `/` | Create template (`zKpiTemplateCreate`). |
| `PUT` | `/:id` | Partial update (`zKpiTemplateUpdate`). |
| `DELETE` | `/:id` | Delete template (org-scoped). |

---

## `GET /api/v1/templates`

Lists templates for the **active organization** only.

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | 1-based page index. |
| `limit` | number | `10` | Page size. |
| `search` | string | `""` | If non-empty, adds `$or` regex (case-insensitive) on **`name`** and **`role`**. |
| `departmentId` | string | — | Exact match filter on `departmentId`. |
| `role` | string | — | Exact match filter on `role`. |

### Success

- **HTTP:** `200`
- **`data`:** `{ docs, total, page, limit, totalPages, hasNextPage, hasPreviousPage, message }`

`docs` are lean Mongo documents (stringified ObjectIds in JSON responses).

---

## `GET /api/v1/templates/:id`

### Params

- **`id`:** template ObjectId string.

### Success

- **HTTP:** `200` — `{ template, message: 'KPI template fetched successfully' }`

### Not found

- **HTTP:** `404` — `{ message: 'KPI template not found' }`  
  (wrong id, or template belongs to another organization.)

---

## `POST /api/v1/templates`

Creates a template. Body must pass **`zKpiTemplateCreate`** (same shape as `zKpiTemplate` without `id`, `createdAt`, `updatedAt`).

### Request body (summary)

| Field | Type | Notes |
|-------|------|--------|
| `organizationId` | string | Required by schema; **overwritten** with session org on save. |
| `departmentId` | string | **Effectively required** for successful `validateRoleInDepartment`. |
| `role` | string | Required; must match an employee role in that department. |
| `name` | string | Required. |
| `description` | string | Optional. |
| `items` | array | Required; min length **1**; each element **`zKpiItem`**. |

### Success

- **HTTP:** `201` — `{ template, message: 'KPI template created successfully' }`

### Errors

| `TITLE` / case | When |
|----------------|------|
| `VALIDATION_ERROR` | Zod: items, judgement/inputType pairing, `maxMarks`, etc. |
| `INVALID_DEPARTMENT` | `departmentId` not found. |
| `INVALID_ROLE_FOR_DEPARTMENT` | No employee with matching `departmentRole` in that department. |

---

## `PUT /api/v1/templates/:id`

Partial update; **`zKpiTemplateUpdate`** = partial of create (all top-level fields optional).

### Behavior

- Loads template by **`id`** + **`organizationId`**; if missing → **404**.
- Merges **`departmentId`** / **`role`** with existing values; if both resolved values are non-empty, **`validateRoleInDepartment`** runs again.
- Applies **`$set: patch`** (only fields present in body are updated).

### Success

- **HTTP:** `200` — `{ template, message: 'KPI template updated successfully' }`

### Not found

- **HTTP:** `404` — `{ message: 'KPI template not found' }`

### Errors

Same as create when department/role validation runs.

---

## `DELETE /api/v1/templates/:id`

Deletes the template if **`_id`** + **`organizationId`** match.

### Success

- **HTTP:** `200` — `{ template, message: 'KPI template deleted successfully' }` (returns deleted doc)

### Not found

- **HTTP:** `404` — `{ message: 'KPI template not found' }`

**Note:** Deleting a template does not automatically delete existing **entries** that reference it; handle that at the product level if needed.

---

## Relationship to entries and scoring

- **`KpiEntryService`** loads the template at upsert time, matches items by id, and computes **`awardedMarks`** using **`computeMarks`** with the rules above (`entries.service.ts`).
- Entry line items store **`maxMarks`**, **`judgement`**, **`awardedMarks`**, and input values so historical submissions stay interpretable even if the template changes later.
- **Bulk import** builds columns from template item ids; see employee/import docs for CSV shape.

---

## Quick reference: judgement → formula

| Type | Formula (conceptually) |
|------|-------------------------|
| `percent` | `clamp(maxMarks * (pct/100), 0, maxMarks)` with `pct ∈ [0,100]`; no `unit` field |
| `boolean` | `true` → `maxMarks`; `false` → `0` |
| `range` | First matching band in `ranges[]` → `clamp(band.marks, 0, maxMarks)`; else `0` |
| `target` / `best_match` | highest slab with `achieved ≥ target`; else `0`; then clamp |
| `target` / `nearest` | slab minimizing `|achieved - target|`; then clamp |

---

## Related modules

- **`/entries`:** `templateId` + per-item values; server recomputes marks from stored judgement snapshots.
- **Employee / departments:** `departmentId` and `departmentRole` drive template validation.
- **Periods:** entries are tied to periods for locking and reporting.
