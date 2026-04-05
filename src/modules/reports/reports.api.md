# KPI Reports API

**Base path:** `/api/v1/reports`

---

## What this module is

Reports are **normalized snapshots** for a locked period: a **`ReportRun`** row (metadata), **`ReportDepartmentRole`** rows (aggregates per department + role), and **`ReportRanking`** rows (overall and per-department leaderboards). Generation runs from the **period maintenance cron** when a period transitions to **`locked`**.

## Why it exists

Large orgs produce too much data for one Mongo document; splitting **run**, **department-role stats**, and **rankings** keeps reads fast and avoids the 16MB document limit. **Business rule:** consumers only read report APIs when the period is **`closed`** (except list behavior—see below).

---

## Auth and scope

- Every handler requires **`req.session.activeOrganizationId`** (`NO_ACTIVE_ORGANIZATION` when missing).
- Data is always filtered by **`organizationId`** and **`periodId`**.

---

## Visibility rule (closed period)

- **`getReportSummary`**, **`getDepartmentRoleStats`**, and **`getRanking`** call services that **throw `REPORT_NOT_READY` (400)** if the KPI period’s **`status` is not `closed`**.
- **`list`** (`GET /`) returns **report run metadata** from `ReportRunModel` **without** applying the closed check—use it for admin UI that lists generated runs; still org-scoped.

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | List report **runs** (metadata) for the org, newest first. |
| `GET` | `/:periodId/department-report-zip` | Download department-wise report ZIP (PDF per department with role-wise rankings). |
| `POST` | `/:periodId/whatsapp/send` | Manual trigger / retry for **WhatsApp** performance messages (**owner** / **admin** / **nodal** only). |
| `GET` | `/:periodId/whatsapp/sends` | List **audit records** for WhatsApp sends for a period (**owner** / **admin** / **nodal** only). |
| `GET` | `/:periodId/summary` | Single **run** row for a period (**closed-only**). |
| `GET` | `/:periodId/department-roles` | Department × role aggregates (**closed-only**). |
| `GET` | `/:periodId/ranking/:scope` | Paginated rankings: `overall` or `department` (**closed-only**). |

**Route order:** `/:periodId/whatsapp/*` is registered before `/:periodId/summary` so paths are not ambiguous.

---

## `GET /api/v1/reports`

**Description (2 lines):** Returns all **`kpi_report_runs`** documents for the active organization, sorted by **`generatedAt`** descending. Does **not** enforce period `closed` (metadata only).

### Request

- None.

### Success response

- **HTTP:** `200`
- **`data`:** `{ reports: ReportRun[], message }`

**`ReportRun` (lean document, illustrative):**

| Field | Description |
|-------|-------------|
| `_id` | Run id. |
| `organizationId` | Org. |
| `periodId` | KPI period. |
| `periodKey` | e.g. anchored period key string. |
| `generatedAt` | When snapshot was written. |
| `status` | e.g. `generated`. |
| `createdAt` / `updatedAt` | Timestamps. |

---

## `GET /api/v1/reports/:periodId/summary`

**Description (2 lines):** Fetches the **report run** document for **`periodId`** for summary dashboards. **Throws `REPORT_NOT_READY`** until the period is **`closed`**.

### Request

- **Params:** `periodId` — KPI period ObjectId.

### Success response

- **HTTP:** `200` — `{ run, message }`  
  `run` is a single **ReportRun** lean document or null-shaped handling.

### Errors / not found

| Case | HTTP | `TITLE` / body |
|------|------|----------------|
| Period missing | 404 | `{ message: 'Report not found' }` |
| Period not closed | 400 | `REPORT_NOT_READY` |
| No run row | 404 | `{ message: 'Report not found' }` |

---

## `GET /api/v1/reports/:periodId/department-roles`

**Description (2 lines):** Returns **`ReportDepartmentRole`** documents: per **department**, per **role**, employee counts and mark totals/averages. Optional filter to one department.

### Request

- **Params:** `periodId`
- **Query:** `departmentId?` — if set, only stats for that department.

### Success response

- **HTTP:** `200` — `{ stats: ReportDepartmentRole[], message }`

**`ReportDepartmentRole` fields (illustrative):** `departmentId`, `role`, `employees`, `avgObtainedMarks`, `totalObtainedMarks`, `totalMarks`, plus ids and timestamps.

### Errors

Same **`REPORT_NOT_READY`** rule when period not **`closed`**; **404** if period missing or no data path returns null.

---

## `GET /api/v1/reports/:periodId/ranking/:scope`

**Description (2 lines):** Paginated **`ReportRanking`** rows. **`scope`** must be **`overall`** or **`department`**. For **`department`**, **`departmentId`** query is **required** or the handler throws **`MISSING_DEPARTMENT`**.

### Request

- **Params:** `periodId`, `scope` — `overall` | `department`
- **Query:** `departmentId?` (required when `scope=department`), `page?` (default `1`), `limit?` (default `50`)

### Success response

- **HTTP:** `200`

```json
{
  "docs": [
    {
      "scope": "overall",
      "employeeId": "",
      "employeeName": "",
      "departmentId": "",
      "role": "",
      "obtainedMarks": 0,
      "totalMarks": 0,
      "rank": 1
    }
  ],
  "total": 0,
  "page": 1,
  "limit": 50,
  "totalPages": 0,
  "hasNextPage": false,
  "hasPreviousPage": false,
  "message": "Ranking fetched"
}
```

### Errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `INVALID_SCOPE` | 400 | `scope` not `overall` or `department`. |
| `MISSING_DEPARTMENT` | 400 | `scope=department` without `departmentId`. |
| `REPORT_NOT_READY` | 400 | Period not `closed`. |
| — | 404 | `{ message: 'Report not found' }` when period/run missing. |

---

## Lifecycle reminder

1. Period becomes **`locked`** → cron calls **`generateIfMissingForLockedPeriod`** → writes run + aggregates + rankings.  
2. After snapshot generation succeeds, WhatsApp performance send automation is triggered in background (`dryRun=false`, `resend=false`, safe default delay).  
3. After snapshot generation succeeds, department-wise PDF ZIP generation is triggered in background; owners/admins are notified by email.
4. Period becomes **`closed`** → **read** endpoints succeed for that `periodId`.

---

## Department-wise report ZIP (PDF bundle)

This feature generates one PDF per department (with **role-wise** sections: rank + score), then zips all PDFs into one archive stored under **`uploads/temp`**.

### Storage and retention

- ZIP metadata is tracked in `kpi_report_zip_artifacts`.
- Files are retained for **2 days** (`expiresAt`) then deleted.
- Cleanup runs during daily period cron and before on-demand generation/download.

### Auto-generation trigger

- Triggered automatically after report snapshot generation succeeds (same lock-stage flow where report artifacts are created).
- Owners/admins are emailed with the full ZIP when a new artifact is generated.
- Nodals are also emailed, but only with PDFs for departments assigned to them (`assignedNodal`).

### `GET /api/v1/reports/:periodId/department-report-zip`

- **Auth:** `requireKpiOrgAdmin` (`owner` / `admin` / `nodal`).
- **Query:** `force?` (`true`/`1`) to force regenerate the ZIP immediately.
- Returns the ZIP as attachment (`Content-Type: application/zip`).
- If a valid non-expired ZIP already exists (same template version), it is served directly.
- If missing/expired, service regenerates from report ranking data and then serves.
- Renderer uses HTML template styling (reference-like layout). If browser rendering is unavailable, service falls back to a plain PDF renderer.

### Errors

| `TITLE` | HTTP | When |
|---------|------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 | No active org in session |
| `REPORT_NOT_READY` | 400 | Report snapshot missing for that period |
| `NO_REPORT_RANKING_DATA` | 400 | No department ranking rows to build PDFs |
| `PERIOD_NOT_FOUND` | 404 | Period id not found for org |
| `REPORT_ZIP_NOT_FOUND` | 404 | ZIP path missing after generation attempt |

---

## WhatsApp performance notifications

Third-party WhatsApp campaigns let each **employee** receive a **different** template message after report snapshots exist. Sending hundreds or thousands of messages takes time, so this is intended to run while the period is **`locked`** or **`closed`** (after **`ReportRun`** + rankings exist—not while the period is still **`active`**).

### Auth

- **`POST .../whatsapp/send`** and **`GET .../whatsapp/sends`** require **`requireKpiOrgAdmin`**: session **`activeOrganizationId`** and org role **`owner`**, **`admin`**, or **`nodal`**. Others get **`403`** `ORG_ADMIN_REQUIRED`.

### Environment (server)

| Variable | Required to **send** | Description |
|----------|----------------------|-------------|
| `WHATSAPP_API_URL` | Yes (or use **`dryRun: true`**) | Provider POST URL (e.g. api-wa campaign endpoint). |
| `WHATSAPP_API_KEY` | Yes (unless **`dryRun`**) | API key / JWT for the provider. **Never commit**; use `.env` only. |
| `WHATSAPP_DISPLAY_NAME` | No | `userName` field in the provider payload (sender display). |
| `WHATSAPP_SOURCE` | No | `source` string (default `kpi-reports`). |
| `WHATSAPP_CAMPAIGN_TOP` | No | Campaign name for **top** bucket (default `Top_Perfomer_API`). |
| `WHATSAPP_CAMPAIGN_MEDIUM` | No | Campaign name for **medium** (default `Medium_Perfomer_API`). |
| `WHATSAPP_CAMPAIGN_BOTTOM` | No | Campaign name for **bottom** (default `Bottom_Performer`). |

| `WHATSAPP_AUTO_DELAY_MS` | No | Delay per recipient for auto-triggered runs (default `350` ms). |

If `WHATSAPP_API_URL` or `WHATSAPP_API_KEY` is missing and **`dryRun`** is false, sending is skipped by error handling (`WHATSAPP_NOT_CONFIGURED` on manual call; auto trigger logs and continues report flow).

### Data model: `kpi_whatsapp_report_sends`

Each attempt creates a row for **audit**, nodal dashboards, and debugging:

| Field | Description |
|-------|-------------|
| `organizationId`, `periodId`, `batchId` | Scope and one **batch** id per **`POST /whatsapp/send`** run. |
| `employeeId`, `departmentId` | Employee and department. |
| `phoneDigits`, `phoneMasked` | Normalized destination (masked for safer UI display). |
| `status` | `pending` → `sent` or `failed`; `skipped` for no phone, already sent, etc. |
| `performerBucket` | `top` \| `medium` \| `bottom` (from **department + role** cohort rank + cohort size rules). |
| `campaignName`, `templateParams` | What was sent to the provider. |
| `dryRun` | `true` if no HTTP call was made. |
| `providerResponse` | Truncated JSON from the provider (or error metadata). |
| `errorMessage` | On failure. |
| `triggeredByUserId` | Session user who started the batch. |
| `sentAt` | When marked successful. |

### Who receives messages

Performance WhatsApp is sent to **all employees present in report ranking rows** for the selected period/department scope. Membership linkage is **not required** (`tb_employees.userId` / `member.role` are not used for eligibility).

Rows may still be skipped for operational reasons only (e.g. missing employee document, missing role scope, invalid phone, or already sent when `resend=false`).

### Ranking and templates

- Personalized rank is recomputed at send-time by **`departmentId + role`** cohort from **`ReportRanking(scope='department')`** rows (same score ordering as report generation).
- **Performance bucket** (top / medium / bottom) uses cohort size rules (e.g. small departments: top/bottom by rank; larger: approximate top/bottom 5% with a minimum count)—see `classifyPerformerBucket` in **`whatsappPerformance.service.ts`**.
- **KPI text** in the message is built from that employee’s **`kpi_entries`** lines for the period (**`items[].title`** + **`awardedMarks`**).
- **Phone** is taken from **`tb_employees.phone`**, normalized to **`91` + 10 digits** when possible.

### `POST /api/v1/reports/:periodId/whatsapp/send`

**Body (JSON):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dryRun` | boolean | `false` | If **`true`**, builds payloads and writes **`sent`** records with `providerResponse: { dryRun: true }` but **does not** call the provider (no API key required). |
| `departmentId` | string | — | If set, only employees in that **department’s** ranking rows are processed. |
| `delayMs` | number | `350` | Delay between each employee send (**0**–**120000** ms) to reduce rate limits. |
| `resend` | boolean | `false` | If **`false`**, employees who already have a **`status: sent`** (non–dry-run) record for this period are **skipped** (a **`skipped`** audit row is still written with reason **`already_sent`**). |

**Success:**

- When **`BACKGROUND_JOBS_SYNC=false`** (default): **`202 Accepted`** — **`mode`**: **`queued`**, **`jobId`**, **`message`**. Poll **`GET /api/v1/jobs/:jobId`** (owner/admin/nodal) for **`state`** and **`returnvalue`** when the batch finishes.
- When **`BACKGROUND_JOBS_SYNC=true`**: **`200`** — **`mode`**: **`sync`**, plus **`batchId`**, **`summary`** (`sent`, `failed`, `skipped`, `dryRun`), **`message`**, **`departmentNamesSample`**.

**Errors:**

| `TITLE` | HTTP | When |
|---------|------|------|
| `NO_ACTIVE_ORGANIZATION` | 400 | No active org. |
| `ORG_ADMIN_REQUIRED` | 403 | Not owner/admin/nodal. |
| `PERIOD_NOT_FOUND` | 404 | |
| `PERIOD_NOT_READY_FOR_WHATSAPP` | 400 | Period not **`locked`** or **`closed`**. |
| `REPORT_NOT_READY` | 400 | No **`ReportRun`** for this period yet. |
| `NO_RANKING_DATA` | 400 | No department ranking rows. |
| `WHATSAPP_NOT_CONFIGURED` | 400 / 500 | Missing env or provider HTTP error when sending. |
| `JOB_QUEUE_UNAVAILABLE` | 503 | Redis down or queue error when enqueueing (non–sync mode). |

### `GET /api/v1/reports/:periodId/whatsapp/sends`

**Query:** `page`, `limit` (max **100**), optional `status` (`pending` \| `sent` \| `failed` \| `skipped`), optional `departmentId`.

**Success:** Paginated **`docs`** (newest first), **`total`**, page metadata, **`message`**.

---

## Related

- **Periods API** — config and cron behavior.  
- **Entries** — source data for aggregates.
