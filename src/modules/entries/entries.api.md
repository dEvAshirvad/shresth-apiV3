# KPI Entries API

**Base path:** `/api/v1/entries`

---

## What this module is

A **KPI entry** is one employee’s scores for a given **`templateId`** and **`periodId`**, stored in **`kpi_entries`** as:

- **`items[]`**: one row per template line item (`templateItemId`), with **`inputValueNumber`** and/or **`inputValueBoolean`**, server-filled **`title`**, **`inputType`**, **`maxMarks`**, and server-computed **`awardedMarks`**.
- **Rollups:** **`totalMarks`** (sum of line **`maxMarks`**) and **`obtainedMarks`** (sum of **`awardedMarks`**).
- **`status`:** `draft` → `submitted`; **`locked`** exists on the schema for rows tied to a locked reporting window (this module only sets **`draft`** / **`submitted`** via the routes above).

**Unique key:** **`employeeId` + `periodId` + `templateId`** (one upsertable document per employee–period–template).

Entries **do not** store the full template **`judgement`** tree on each line at rest in the Zod type shown below; the server reads the **live template** on each upsert and recomputes **`awardedMarks`** from **`computeMarks`** (`entries.service.ts`) using the same rules as **`templates.api.md`** (percent, target slabs, boolean → full **`maxMarks`** when true, range **`ranges[]`** with legacy single-band fallback).

---

## Why it exists

- Enforces **period state** (only **`active`** periods allow draft save/import/submit).
- Aligns **employee**, **template** (org, optional department, role), and **period** to the active organization.
- Keeps **marks consistent** with the current template definition at save time.

---

## Auth and scope

- All handlers require **`req.session.activeOrganizationId`**. If missing → **400** **`NO_ACTIVE_ORGANIZATION`**.
- Reads and writes are always scoped by **`organizationId`** on the entry, template, and period.

---

## Relationship to templates (scoring)

For each **`templateItemId`** in the request, the server loads the matching template item and calls **`computeMarks`** with:

- **`maxMarks`**, **`judgement`** from the template item,
- **`inputValueNumber`** / **`inputValueBoolean`** from the client.

Behaviour matches **Templates API** judgement types:

| Template `judgement.type` | Client must supply | Notes |
|---------------------------|-------------------|--------|
| `percent` | `inputValueNumber` (0–100) | `awardedMarks` scales linearly to **`maxMarks`**. |
| `target` | `inputValueNumber` | Slabs / `best_match` / `nearest`. |
| `boolean` | `inputValueBoolean` | **`true`** → **`maxMarks`**; **`false`** → **0** (no `trueMarks`). |
| `range` | `inputValueNumber` | First matching band in **`ranges[]`**; legacy **`min`/`max`/`marks`** supported for old data. |

**`inputType`** on the stored line comes from the template; clients should send values consistent with that (number vs boolean).

---

## Data model (response shape)

### Entry document in MongoDB (summary)

| Field | Description |
|-------|-------------|
| `organizationId`, `departmentId`, `periodId`, `templateId`, `employeeId` | ObjectIds (strings in JSON). |
| `roleSnapshot` | Employee **`departmentRole`** or template **`role`** at save time. |
| `items[]` | One stored line per template item (see **Stored line item**). |
| `totalMarks` | Sum of **`maxMarks`** across lines. |
| `obtainedMarks` | Sum of **`awardedMarks`**. |
| `status` | `draft` \| `submitted` \| `locked`. |

### Stored line item (persisted `items[]` on upsert/import)

| Field | Description |
|-------|-------------|
| `templateItemId` | Template item **`_id`**. |
| `title`, `inputType`, `maxMarks` | Copied from template at upsert. |
| `inputValueNumber`, `inputValueBoolean` | Last saved inputs. |
| `awardedMarks` | Server-computed. |
| `remarks` | Optional note. |

### Entry document on **`GET /`** and **`GET /:id`** (enriched)

Read handlers populate **`employeeId`** and **`templateId`**, then reshape the JSON so ids stay string fields and full documents are separate (Mongoose **`populate`** replaces ref fields; the API splits them back for a stable contract):

| Field | Description |
|-------|-------------|
| `employeeId` | String ObjectId (always the id, not a nested object). |
| `employee` | Populated employee document (`tb_employees`), when resolve succeeds. |
| `templateId` | String ObjectId. |
| `template` | Populated KPI template document (`kpi_template`), including **`items`** (definitions with **`judgement`**). |
| `organizationId`, `departmentId`, `periodId` | String ids as returned by lean JSON. |
| `items[]` | **Merged** rows: order follows **`template.items`**. Each object combines the **template line** (e.g. **`judgement`**, **`isActive`**, description) with the **saved entry line** for that **`templateItemId`** (scores, remarks). Stored-only fields are layered on top of the template row; **`templateItemId`** on each line is a string. |

**Write responses** (**`POST /`**, **`POST /:id/submit`**, etc.) return the persisted entry from the service **without** this GET enrichment unless noted otherwise.

### Line item in GET responses (`items[]` after merge)

Each element includes template definition fields from the live template plus saved values, for example: **`judgement`**, **`inputType`**, **`maxMarks`**, **`inputValueNumber`**, **`inputValueBoolean`**, **`awardedMarks`**, **`remarks`**, **`templateItemId`**.

### Upsert body (`zKpiEntryUpsertInput`)

| Field | Required | Description |
|-------|----------|-------------|
| `employeeId` | yes | Employee ObjectId. |
| `templateId` | yes | Template ObjectId. |
| `periodId` | no | Defaults to current **`active`** period for the org (latest by **`startDate`**). |
| `items` | yes (min 1) | Array of **`templateItemId`** + values only (see **`zKpiEntryItemInput`**). |

Each input line:

| Field | Description |
|-------|-------------|
| `templateItemId` | Must exist on the template. |
| `inputValueNumber` | Use for `number`, `percent`, `target`, `range` lines. |
| `inputValueBoolean` | Use for `boolean` lines. |
| `remarks` | Optional. |

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/import/template` | Download CSV/XLSX **blank** (same layout as import; empty KPI cells). |
| `GET` | `/import/entries` | Download CSV/XLSX in the **same layout**, cells filled from saved **`kpi_entries`**. |
| `POST` | `/import` | Bulk upsert **drafts** from uploaded file + query params. |
| `GET` | `/` | Paginated list with filters. |
| `POST` | `/bulk-submit` | Submit many entries in one request (same rules as **`/:id/submit`**). |
| `GET` | `/:id` | Single entry. |
| `POST` | `/` | Upsert **draft** (same employee + period + template). |
| `POST` | `/:id/submit` | **`draft`** → **`submitted`** if period is **active**. |
| `DELETE` | `/:id` | Delete entry only if **`draft`**. |

**Route order:** `/import/*` and **`/bulk-submit`** are registered **before** `/:id` so those path segments are not captured as entry ids.

---

## `GET /api/v1/entries/import/template`

Builds a spreadsheet: one row per **employee** in **`departmentId`** whose **`departmentRole`** matches the template’s **`role`** (case-insensitive). If the template has **no** **`role`**, all employees in the department are included.

### Query (validated)

| Param | Required | Description |
|-------|----------|-------------|
| `templateId` | yes | Template ObjectId. |
| `departmentId` | yes | Department ObjectId. |
| `format` | no | `csv` (default) or `xlsx`. |

### Columns

- **`employeeId`**, **`name`**, **`email`**, **`phone`**
- For each template line item, two columns (empty cells for user fill):
  - **Value:** `{title} ({inputType}, max {maxMarks}) [{templateItemId}]` — human-readable title plus type and cap, with the template item ObjectId in brackets at the end (stable for import).
  - **Remark:** `Remark — {title} [{templateItemId}]`

Legacy exports using **`item_<templateItemId>`** and **`remark_<templateItemId>`** are still accepted on import.

### Success

- **200** — File download: `kpi-entries-import-template.csv` or `.xlsx`.

### Errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 | No session org. |
| `MISSING_PARAMS` | 400 | Missing `templateId` or `departmentId`. |
| `TEMPLATE_NOT_FOUND` | 404 | |
| `TEMPLATE_FORBIDDEN` | 403 | Template belongs to another org. |
| `TEMPLATE_DEPARTMENT_MISMATCH` | 400 | Template is bound to a different department than `departmentId`. |

---

## `GET /api/v1/entries/import/entries`

Same **row set** and **columns** as **`GET /import/template`** (employee roster for **`departmentId`** + template **role** filter; same human-readable KPI headers). Cells are filled from existing entry documents for **`templateId`** + resolved **`periodId`**, not left blank.

- If an employee has **no** entry yet, value and remark cells for that row are empty (same as downloading the blank template and typing nothing).

### Query (validated)

| Param | Required | Description |
|-------|----------|-------------|
| `templateId` | yes | Template ObjectId. |
| `departmentId` | yes | Department ObjectId. |
| `periodId` | no | Explicit period. If **omitted**, uses the current **`active`** period (latest by **`startDate`**), same default as draft upsert / import. If **set**, that period is used **read-only** — export works for **`active`**, **`locked`**, or **`closed`** periods (e.g. archived snapshots). |
| `format` | no | `csv` (default) or `xlsx`. |

### Cell values

- **Boolean** lines: exported as **`true`** or **`false`** (empty if never set).
- **Number** / **percent** lines: exported as the stored numeric string (empty if missing / non-finite).
- **Remark** columns: stored remark text, or empty.

### Success

- **200** — File download: `kpi-entries-export.csv` or `kpi-entries-export.xlsx`.

### Errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 | No session org. |
| `MISSING_PARAMS` | 400 | Missing `templateId` or `departmentId`. |
| `TEMPLATE_NOT_FOUND` | 404 | |
| `TEMPLATE_FORBIDDEN` | 403 | Template belongs to another org. |
| `TEMPLATE_DEPARTMENT_MISMATCH` | 400 | Template is not for this `departmentId`. |
| `NO_ACTIVE_PERIOD` | 400 | No `periodId` and no **active** period exists. |
| `PERIOD_NOT_FOUND` | 404 | `periodId` does not exist. |
| `PERIOD_FORBIDDEN` | 403 | Period not in this org. |

---

## `POST /api/v1/entries/import`

**Content-Type:** **`multipart/form-data`** with field **`file`** (CSV or XLSX).

### Query (validated)

| Param | Required | Description |
|-------|----------|-------------|
| `templateId` | yes | Template ObjectId. |
| `departmentId` | yes | Department ObjectId (must match template department when template is department-scoped). |
| `periodId` | no | Explicit period; if omitted, uses current **active** period (same resolution as draft upsert). |

### File

- **`.csv`** or **`.xlsx`**; first sheet used for Excel.
- Headers should match the template download, or legacy **`item_<templateItemId>`** / **`remark_<templateItemId>`**. The importer resolves value vs remark columns by **`[id]`** suffix on the new-style headers, or by the legacy names. Column lookup is **case-insensitive** for row keys.

### Row processing

- **`employeeId`** required per row; must be an employee in **`departmentId`**.
- If the template defines **`role`**, employee **`departmentRole`** must match (case-insensitive).
- **Value** cells (per line item): for **boolean** items, truthy strings are **`true`**, **`1`**, **`yes`**, **`y`** (case-insensitive); otherwise **number** parsing (non-finite → **0** for numeric types). Applies whether the column is the readable header or legacy **`item_<id>`**.

### Success

**200** — Example:

```json
{
  "processed": 10,
  "upserted": 8,
  "errors": [
    { "row": 3, "employeeId": "...", "message": "Employee role does not match template role" }
  ],
  "periodId": "<resolved period id>",
  "message": "Entries imported successfully"
}
```

- **`processed`:** number of data rows read.
- **`upserted`:** rows that produced a bulk upsert candidate (may still share the same unique key as a previous run).
- **`errors`:** per-row failures (row number is **1-based data row**; header is row 1, so first data row is typically **2**).

### Errors (request-level)

| `TITLE` | When |
|---------|------|
| `NO_ACTIVE_ORGANIZATION` | |
| `MISSING_PARAMS` | Missing `templateId` or `departmentId`. |
| `NO_FILE` | No file uploaded. |
| `EMPTY_FILE` | Excel workbook has no sheets. |
| `UNSUPPORTED_FILE` | Not `.csv` / `.xlsx`. |
| `TEMPLATE_NOT_FOUND` / `TEMPLATE_FORBIDDEN` / `TEMPLATE_DEPARTMENT_MISMATCH` | Same as template download. |
| `NO_ACTIVE_PERIOD` | No period when `periodId` omitted and no active period exists. |
| `PERIOD_FORBIDDEN` | Resolved period not in org. |
| `PERIOD_LOCKED` | Resolved period is not **`active`**. |

---

## `GET /api/v1/entries`

Paginated list for the **active organization**. Each document in **`docs`** uses the **enriched** entry shape (**`employee`**, **`template`**, merged **`items`**) described under **Entry document on GET**.

### Query

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page index. |
| `limit` | number | `10` | Page size. |
| `employeeId` | string | — | Filter by employee ObjectId. |
| `periodId` | string | — | Filter by period ObjectId. |
| `templateId` | string | — | Filter by template ObjectId. |

### Success

**200** — `{ docs, total, page, limit, totalPages, hasNextPage, hasPreviousPage, message }`

- **`docs`:** array of entries; each entry includes **`employeeId`** (string), optional **`employee`**, **`templateId`** (string), optional **`template`**, and merged **`items[]`**.

---

## `POST /api/v1/entries/bulk-submit`

Runs the same submit logic as **`POST /:id/submit`** for each id: entry must belong to the org; the entry’s **period** must be **`active`**; then **`status`** is set to **`submitted`**. Duplicate ids in the body are processed once. Invalid ObjectIds and per-entry failures do not stop the rest.

### Body (validated)

| Field | Required | Description |
|-------|----------|-------------|
| `entryIds` | yes | Array of entry ObjectId strings, **1–500** items. |

### Success

**200** — Example:

```json
{
  "submitted": [ { /* entry documents */ } ],
  "errors": [
    { "entryId": "<id>", "message": "Period is locked/closed; cannot submit" }
  ],
  "submittedCount": 2,
  "errorCount": 1,
  "message": "Bulk submit completed"
}
```

- **`submitted`:** entries updated successfully (full documents as returned from the DB).
- **`errors`:** entries that were not found, had invalid ids, or failed **`PERIOD_LOCKED`** (or other operational errors); each item has **`entryId`** and **`message`**.

### Errors (request-level)

| `TITLE` | HTTP | When |
|---------|------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 | No session org. |
| `NO_ENTRY_IDS` | 400 | Empty **`entryIds`** after trimming (should not occur if Zod passes). |
| `VALIDATION_ERROR` | 400 | Body fails Zod (e.g. missing **`entryIds`**, or array length not between 1 and 500). |

---

## `GET /api/v1/entries/:id`

### Params

- **`id`** — Entry ObjectId.

### Success

- **200** — `{ entry, message }` (`message`: `Entry fetched successfully`)

**`entry`** uses the **enriched** shape: **`employeeId`** + **`employee`**, **`templateId`** + **`template`**, merged **`items[]`** (see **Entry document on GET**).

### Not found

- **404** — `{ message: 'Entry not found' }`

---

## `POST /api/v1/entries`

Upserts a **draft** for **`employeeId` + `periodId` + `templateId`**. Recomputes every line’s **`awardedMarks`**, **`totalMarks`**, **`obtainedMarks`**, and resets **`status`** to **`draft`**.

### Period resolution

- If **`periodId`** is omitted: **`findOne({ organizationId, status: 'active' }).sort({ startDate: -1 })`**.
- Period must exist, belong to the org, and **`status === 'active'`**.

### Validation chain

1. **Employee** exists and has a **department**.
2. **Template** exists, org matches, template **department** (if set) matches employee department, template **role** (if set) matches employee **`departmentRole`** (case-insensitive).
3. **Period** as above.
4. Every **`templateItemId`** exists on the template (**`INVALID_TEMPLATE_ITEM`** if not).

### Request body example

```json
{
  "employeeId": "<ObjectId>",
  "templateId": "<ObjectId>",
  "periodId": "<ObjectId optional>",
  "items": [
    {
      "templateItemId": "<ObjectId>",
      "inputValueNumber": 85,
      "remarks": "optional"
    },
    {
      "templateItemId": "<ObjectId>",
      "inputValueBoolean": true
    }
  ]
}
```

Use **`inputValueNumber`** for percent / number / target / range lines; **`inputValueBoolean`** for boolean lines.

### Success

- **201** — `{ entry, message: 'KPI entry draft saved' }`

### Typical errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 | |
| `INVALID_ORGANIZATION_ID` | 400 | Invalid session org id. |
| `EMPLOYEE_NOT_FOUND` | 404 | |
| `EMPLOYEE_NO_DEPARTMENT` | 400 | |
| `TEMPLATE_NOT_FOUND` | 404 | |
| `TEMPLATE_FORBIDDEN` | 403 | Wrong org. |
| `TEMPLATE_DEPARTMENT_MISMATCH` | 400 | Template scoped to another department. |
| `ROLE_MISMATCH` | 400 | Employee role vs template role. |
| `NO_ACTIVE_PERIOD` | 400 | No active period when `periodId` omitted. |
| `PERIOD_FORBIDDEN` | 403 | Period wrong org. |
| `PERIOD_LOCKED` | 400 | Period not **active**. |
| `INVALID_TEMPLATE_ITEM` | 400 | Unknown **`templateItemId`**. |
| `VALIDATION_ERROR` | 400 | Zod body validation. |

---

## `POST /api/v1/entries/:id/submit`

Sets **`status`** to **`submitted`** if the entry’s **period** is still **`active`** (same transition as **`POST /bulk-submit`** for a single id).

### Success

- **200** — `{ entry, message: 'KPI entry submitted' }`

### Not found

- **404** — `{ message: 'Entry not found' }`

### Errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `PERIOD_LOCKED` | 400 | Period not **active** (locked/closed). |

---

## `DELETE /api/v1/entries/:id`

Deletes the entry **only** when **`status === 'draft'`**.

### Success

- **200** — `{ entry, message: 'Draft entry deleted' }` (returns deleted document)
- **404** — `{ message: 'Entry not found' }`

### Errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `NOT_DRAFT` | 400 | Entry is **submitted** or **locked**. |

---

## Status lifecycle

| Status | Meaning |
|--------|---------|
| `draft` | Editable; can delete; can overwrite via upsert/import. |
| `submitted` | Via **`POST /:id/submit`** or **`POST /bulk-submit`** while the period is **active**, **or** automatically when the period transitions to **`locked`** (cron or admin force-lock): all remaining **`draft`** rows for that period are promoted to **`submitted`** before report snapshots run. |
| `locked` | Allowed enum value for entries frozen after period lock; not assigned by the HTTP handlers in this module—use org-wide jobs or migrations if you transition **submitted** rows to **`locked`**. |

---

## Related modules

- **Templates:** structure, judgement types, and scoring rules — **`templates.api.md`**.
- **Periods:** only **`active`** periods accept drafts and submit; use **`GET /api/v1/periods`** to list periods for admin tasks.
- **Reports:** consume **submitted** / locked-period data per your reports module.
