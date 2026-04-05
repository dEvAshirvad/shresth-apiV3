## KPI System API (v1)

All routes are **auth-scoped** using:
- `req.user`
- `req.session.activeOrganizationId` (organization context)

### Flowchart (high level)

```mermaid
flowchart TD
  A[Signup/Login] --> B[Create/Select Organization]
  B --> C[Period Config Update]
  C --> D[Start Period System (one-time)]
  D --> E[Periods auto-generated daily 23:59]
  B --> F[Invite Nodals/Admins]
  F --> G[Nodal accepts invite]
  G --> H[Create Departments + assign nodal]
  G --> I[Nodal creates employees for department]
  I --> J[Nodal creates KPI templates per role]
  J --> K[Entries: single upsert or bulk import]
  K --> L[Period becomes LOCKED (no entries)]
  L --> M[Reports snapshot generated]
  M --> N[Period becomes CLOSED]
  N --> O[Reports visible to nodal/admin]
```

---

## Periods (`/api/v1/periods`)

Reads and config (see `periods.api.md`):

- `GET /` — paginated periods (optional `status` filter)
- `GET /config` — org KPI period settings (`frequencyMonths`, `lockingPeriodDays`, `isStarted`, …)
- `GET /:id` — single period (org-scoped)
- `PUT /config` — create/update settings (`startDate` only before `POST /start`)
- `POST /start` — **one-time**: mark started and create the **first** period from the configured anchor

**Org admin only** (`owner` \| `admin` \| `nodal`): `POST /admin/force-lock`, `POST /admin/update-period-dates` (optional `startDate` / `endDate`), `POST /admin/update-end-date` (end only, legacy), `POST /admin/generate-reports`.

Cron runs daily **23:59** and drives **active → locked → closed** transitions (plus report generation on lock). Detail: `periods.api.md`.

---

## Templates (`/api/v1/templates`)

CRUD:
- `GET /` list (supports `departmentId`, `role`, `search`, pagination)
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

**Extra validation on create/update**: `role` must exist in the department employees
(`tb_employees.departmentRole`) for the same `departmentId`.

---

## Employees (`/api/v1/employee`)

CRUD:

- `GET /`
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

Import:

- `GET /import/template?format=csv|xlsx`
- `POST /import` — multipart `file`; JSON body **`departmentId`** (required)

Link users / invitations:

- `POST /sync-from-org-members` — body **`{ departmentId }`**; match email → user → member for rows in that department
- `POST /:id/attach-user-id-and-member-id` — body **`{ userId, memberId }`** (validates department in active org)
- `POST /send-invitation-to-rest-employees` — body **`{ departmentId }`**; **`staff`** role invitations

Detail: `employee.api.md`.

---

## Nodals (`/api/v1/nodal`)

Org-scoped **nodal** candidates (**no** department fields on `tb_nodals`):

- `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`
- `GET /import/template`, `POST /import` — upsert by **phone** in the active org (session only; no `departmentId`)
- `POST /sync-from-org-members` — **no body**; link all nodal rows in the org by email
- `POST /:email/attach-user-id-and-member-id` — path is the nodal’s **email** (URL-encode); body **`{ userId, memberId }`**
- `POST /send-invitation-to-rest-nodals` — **no body**; **`nodal`** role invitations (org-wide batch, service limit applies)

Detail: `nodal.api.md`.

---

## Departments (`/api/v1/departments`)

CRUD + import:
- `GET /`
- `GET /:id`
- `POST /`
- `PUT /:id`
- `PATCH /:id` (assign nodal)
- `DELETE /:id`
- `GET /import/template`
- `POST /import`

Statistics:
- `GET /organization/statistics` — org department count (see `departments.api.md`).  
  (`DepartmentNodalStatistics` exists in the service layer for future use; not exposed as HTTP yet.)

---

## Entries (`/api/v1/entries`)

### Draft upsert (single)
`POST /`

Upserts a draft by `(employeeId, templateId, periodId-or-active)` and **computes marks server-side**.
Blocked if period is `locked/closed`.

### Submit
`POST /:id/submit`

### List/Get/Delete draft
- `GET /`
- `GET /:id`
- `DELETE /:id` (draft only)

### Bulk submit
- `POST /bulk-submit` — many entry ids in one request (same rules as single submit)

### Bulk import (CSV/XLSX)
- `GET /import/template?templateId=...&departmentId=...&format=csv|xlsx` — blank sheet
- `GET /import/entries?templateId=...&departmentId=...&periodId=...&format=...` — same layout, cells filled from saved drafts
- `POST /import?templateId=...&departmentId=...&periodId=...` (multipart `file`)

Server computes marks; response includes per-row `errors[]`.

---

## Reports (`/api/v1/reports`)

Reports are generated automatically when a period becomes **LOCKED** (cron).
WhatsApp performance messaging is also auto-triggered after report snapshot generation; rank is scoped to **department + role** cohorts.

### Background jobs (BullMQ)

Long-running batches use **Redis + BullMQ** unless **`BACKGROUND_JOBS_SYNC=true`** (inline/slow HTTP). Run **`pnpm worker:dev`** alongside the API in development, and **`pnpm start:worker`** in production. Poll **`GET /api/v1/jobs/:jobId`** for status. See **`jobs.api.md`**.

**Read rule:** summary, department-role stats, and rankings require the period to be **CLOSED** (`REPORT_NOT_READY` otherwise). `GET /` lists report-run metadata for the org (newest first).

Endpoints (detail in `reports.api.md`):
- `GET /` — list report runs
- `GET /:periodId/department-report-zip` — download department-wise PDF ZIP (auto-generated after report snapshot; retained 2 days)
- `POST /:periodId/whatsapp/send` — manual retry / on-demand WhatsApp performance messages (owner/admin/nodal; after lock + report snapshot); **`202`** + `jobId` when queued
- `GET /:periodId/whatsapp/sends` — audit log of WhatsApp sends
- `GET /:periodId/summary` — run metadata (closed-only)
- `GET /:periodId/department-roles` — aggregates (closed-only)
- `GET /:periodId/ranking/:scope` — `overall` | `department` (closed-only)

---

## Gaps / next improvements

- **Role normalization**: today roles are free-text; consider a `roles` master per department to avoid typos.
- **Period visibility**: optional `GET /api/v1/periods/current` if you want a dedicated “current period” shortcut (today use list + filter or `GET /:id`).
- **Permissions**: many endpoints rely on org scope; some routes add explicit role checks (e.g. periods `/admin/*`, invitations owner/admin).
- **Report completeness**: detail report endpoints require period **`closed`**; `GET /reports/` lists runs without that check.

---

## Per-module API docs

- `src/modules/jobs/jobs.api.md` (background job status)
- `src/modules/departments/departments.api.md`
- `src/modules/employee/employee.api.md`
- `src/modules/nodal/nodal.api.md`
- `src/modules/auth/invitations/invitations.api.md` (bulk **org admin** CSV import)
- `src/modules/templates/templates.api.md`
- `src/modules/periods/periods.api.md`
- `src/modules/entries/entries.api.md`
- `src/modules/reports/reports.api.md`
- `src/modules/auth/organizations/organizations.api.md`
- `src/modules/auth/onboarding/onboarding.api.md`

