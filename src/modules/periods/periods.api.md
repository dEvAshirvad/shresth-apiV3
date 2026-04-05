# Periods API

**Base path:** `/api/v1/periods`

---

## What this module is

The Periods module stores **per-organization KPI calendar settings** (how long each assessment window is and when entries freeze) and **materializes concrete period documents** (`active` → `locked` → `closed`) that entries and reports attach to.

## Why it exists

KPIs need a **shared time boundary** so everyone submits against the same window, and the org needs a **predictable lock** before scores and reports are finalized. Configuration stays small (one config row); **period rows and status transitions are automatic** (driven by a daily cron) so admins do not manually create every month or quarter.

**Design note:** The anchor **`startDate`** is required **before** `POST /start` so the **first** period aligns to your org’s calendar. After that, automation keys off each period’s stored **`endDate`**: the **next** period always starts on the **UTC calendar day after** that `endDate` (so changing `endDate` shifts when the lock window and rollover happen). After go-live, **frequency** and **locking window** may only change during the **locked** phase of the current period—when entries are already frozen and reports are being finalized—so mid-cycle edits do not corrupt active work.

---

## Auth and scope

- All routes expect an authenticated session (same pattern as the rest of the app).
- **Organization scope** comes from `req.session.activeOrganizationId`. Every read/write uses that id. If it is missing, handlers return **400** with `NO_ACTIVE_ORGANIZATION`.
- **`/admin/*` routes** additionally require `req.session.activeOrganizationRole` to be one of **`owner`**, **`admin`**, or **`nodal`**. Otherwise **403** `ORG_ADMIN_REQUIRED`.

---

## Flow (recommended)

1. **`PUT /config`** once (or as needed **before** start) with `frequencyMonths`, `lockingPeriodDays`, and `startDate` (all required until the system is started).
2. **`POST /start`** once to turn on automation and create the initial period **from the configured anchor**, not from “today.”
3. Later, **`PUT /config`** may change `frequencyMonths` and `lockingPeriodDays` **only** when the **latest** period (by `startDate`) is **`locked`**—not while it is `active`.

---

## All routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Paginated list of periods for the active org (optional `status` filter). |
| `GET` | `/config` | KPI period **settings** document for the active org (`frequencyMonths`, `lockingPeriodDays`, `isStarted`, `startedAt`, etc.); `config` is `null` if never saved. |
| `GET` | `/:id` | Single period by id (org-scoped). |
| `PUT` | `/config` | Before start: set frequency, lock lead time, and anchor `startDate`. After start: update frequency/lock **only** if the latest period is `locked`. |
| `POST` | `/start` | One-time: mark the period system as started and create the **first** period from the configured anchor (`startDate` → `startedAt`), **not** from “today’s” calendar segment. |
| `POST` | `/admin/update-end-date` | **Org admin only:** change the **active** period’s inclusive `endDate` only (same as `update-period-dates` with just `endDate`). |
| `POST` | `/admin/update-period-dates` | **Org admin only:** change **`startDate`** and/or **`endDate`** on the **active** period (see section below). |
| `POST` | `/admin/force-lock` | **Org admin only:** lock → generate reports → set `endDate` to **report day (UTC)** → close period → **create** the next **active** period from that chain. |
| `POST` | `/admin/generate-reports` | **Org admin only:** generate report snapshot for a **locked** or **closed** period; optional **`force`** rebuilds aggregates. |

---

## `GET /api/v1/periods`

Lists KPI periods for the **active organization**, newest `startDate` first.

### Query

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page (1-based). |
| `limit` | number | `20` | Page size (max **100**). |
| `status` | enum | — | Optional: `active`, `locked`, or `closed`. |

### Success

- **200** — `{ docs, total, page, limit, totalPages, hasNextPage, hasPreviousPage, message }`

---

## `GET /api/v1/periods/:id`

Returns one period when **`_id`** belongs to the active org.

### Success

- **200** — `{ period, message }`

### Not found

- **404** — `{ message: 'KPI period not found' }`

---

## `GET /api/v1/periods/config`

Returns the **`kpi_period_configs`** row for the active organization (same fields you send to **`PUT /config`**, plus `isStarted`, `startedAt`, `pendingStartDate` when applicable). If the org has never saved settings, **`config`** is **`null`** and the message explains that (still **200**).

---

## `PUT /api/v1/periods/config`

**Description:** Creates or updates org KPI period **settings**. Before `POST /start`, every call must include **all** of `frequencyMonths`, `lockingPeriodDays`, and `startDate`. After the system has started, only `frequencyMonths` and `lockingPeriodDays` are accepted, and only while the **latest** period document is **`locked`**; `startDate` is rejected.

### Request

- **Headers:** `Content-Type: application/json`
- **Body:**

| Field | Type | Validation | Meaning |
|-------|------|------------|---------|
| `frequencyMonths` | number | integer ≥ 1 | Length of each KPI cycle in months (1 = monthly, 2 = every two months, …). |
| `lockingPeriodDays` | number | integer ≥ 1 | Current period becomes **locked** when the date is within this many days **before** the next period’s start (see cron below). |
| `startDate` | string (ISO) or date | Valid date | **Before start only:** calendar anchor for the first period and all future cycles (stored as UTC midnight for that calendar day). |

Before start, **all three** fields are required on every `PUT`. After start, **`startDate` must not** be sent.

### Success response

- **HTTP status:** `200 OK`

**`data` shape:**

```json
{
  "config": {
    "_id": "<ObjectId>",
    "organizationId": "<ObjectId>",
    "frequencyMonths": 1,
    "lockingPeriodDays": 2,
    "isStarted": false,
    "pendingStartDate": "<ISO date>",
    "startedAt": null,
    "createdAt": "<ISO date>",
    "updatedAt": "<ISO date>"
  },
  "message": "KPI period configuration updated successfully"
}
```

After `POST /start`, responses omit `pendingStartDate` (it is cleared) and include `startedAt` and `isStarted: true`.

### Error responses

| Status | `data.title` | When |
|--------|----------------|------|
| 400 | `NO_ACTIVE_ORGANIZATION` | No active org in session. |
| 400 | `INVALID_ORGANIZATION_ID` | Invalid org id. |
| 400 | `PERIOD_CONFIG_INCOMPLETE` | Before start: any of `frequencyMonths`, `lockingPeriodDays`, or `startDate` missing. |
| 400 | `INVALID_START_DATE` | `startDate` is not a valid date. |
| 400 | `PERIOD_CONFIG_CHANGE_NOT_ALLOWED` | After start: latest period is not `locked` (e.g. still `active`). |
| 400 | `VALIDATION_ERROR` | After start: `startDate` was sent, or body fails schema (e.g. wrong types). |

---

## `POST /api/v1/periods/start`

**Description:** Turns on the automatic KPI period pipeline for the active organization and creates the **first** period from your configured anchor (`pendingStartDate` → `startedAt`). The first row always uses **cycle index 0** from that anchor (e.g. monthly: `startDate` = anchor day, `endDate` = day before the next anchor-day month), even if “today” is still before that window or many months later. **Callable only once** per org.

### Request

- **Headers:** `Content-Type: application/json` (body may be empty).
- **Body:** none required; `{}` is fine.

### Success response

- **HTTP status:** `201 Created`
- **Envelope:** standard app success JSON (`success`, `status`, `timestamp`, `cache`, `data`, optional `requestId`).

**`data` shape:**

```json
{
  "config": {
    "_id": "<ObjectId>",
    "organizationId": "<ObjectId>",
    "frequencyMonths": 1,
    "lockingPeriodDays": 2,
    "isStarted": true,
    "startedAt": "<ISO date>",
    "createdAt": "<ISO date>",
    "updatedAt": "<ISO date>"
  },
  "period": {
    "_id": "<ObjectId>",
    "organizationId": "<ObjectId>",
    "frequencyMonths": 1,
    "key": "YYYY-MM-DD",
    "name": "Mar 2026",
    "startDate": "<ISO date>",
    "endDate": "<ISO date>",
    "status": "active",
    "createdAt": "<ISO date>",
    "updatedAt": "<ISO date>"
  },
  "message": "KPI period system started and initial period generated"
}
```

### Error responses

| Status | `data.title` | When |
|--------|----------------|------|
| 400 | `NO_ACTIVE_ORGANIZATION` | Session has no active org. |
| 400 | `INVALID_ORGANIZATION_ID` | `activeOrganizationId` is not a valid ObjectId string. |
| 400 | `PERIOD_ALREADY_STARTED` | `start` was already called; config has `isStarted: true`. |
| 400 | `PERIOD_CONFIG_INCOMPLETE` | No prior `PUT /config` with a valid `startDate` (`pendingStartDate` missing). |

---

## Admin: `POST /api/v1/periods/admin/update-end-date`

**Auth:** session + org admin role (`owner`, `admin`, or `nodal`).

**Purpose:** Set a new inclusive **`endDate`** (UTC calendar day) on the **active** period — **extend** or **prepone** the cycle. The next period’s start (for cron lock/roll) is always **`endDate + 1` UTC day**.

**Note:** Prefer **`POST /admin/update-period-dates`** with `{ "periodId", "endDate" }` for new clients; this route remains for backward compatibility and delegates to the same logic.

### Request

- **Body:** `{ "periodId": "<ObjectId string>", "endDate": "<ISO date or datetime>" }`

### Validation

- `endDate` ≥ `period.startDate`
- `endDate` ≥ **today (UTC)** + **`lockingPeriodDays`** (full calendar days, UTC)

### Success

- **200** — `{ "period": { ... }, "message": "..." }`

### Errors

| Status | `data.title` | When |
|--------|----------------|------|
| 400 | `END_BEFORE_START` | `endDate` is before the period’s `startDate`. |
| 400 | `END_DATE_TOO_SOON` | `endDate` is before today UTC + `lockingPeriodDays`. |
| 400 | `PERIOD_NOT_ACTIVE` | Period is not `active`. |

---

## Admin: `POST /api/v1/periods/admin/update-period-dates`

**Auth:** session + org admin role (`owner`, `admin`, or `nodal`).

**Purpose:** Adjust **`startDate`** and/or **`endDate`** (UTC calendar days) on the **active** period in one call.

### Is this a good idea?

- **End date only:** Generally **yes** for operations — it only shifts when the cycle ends and when the next period starts (`endDate + 1` UTC day), without rewriting history keys.
- **Start date:** Use **sparingly**. It changes the period’s derived **`key`** and display **`name`**, and can break mental models if entries already exist — therefore **`startDate` is rejected if any KPI entry exists for this period**. It must also sit **after** the previous period’s inclusive end (no overlap) and must not collide with another period’s **`key`** in the org.

### Request

- **Body:** `{ "periodId": "<ObjectId string>", "startDate?": "<ISO>", "endDate?": "<ISO>" }` — at least one of **`startDate`** or **`endDate`** required.

### Validation (summary)

- Period must be **`active`**.
- Final **`endDate`** ≥ final **`startDate`**.
- If **`endDate`** is sent: **`endDate`** ≥ today (UTC) + **`lockingPeriodDays`**.
- If **`startDate`** is sent: no KPI **`kpi_entries`** for this **`periodId`**; **`startDate`** ≥ (previous period’s **`endDate`** + 1 UTC day) when a previous period exists; new derived **`key`** must be unique in the org.

### Success

- **200** — `{ "period": { ... }, "message": "..." }`

### Errors

| Status | `data.title` | When |
|--------|----------------|------|
| 400 | `VALIDATION_ERROR` | Neither `startDate` nor `endDate` provided. |
| 400 | `PERIOD_HAS_ENTRIES` | `startDate` sent but entries exist for this period. |
| 400 | `START_OVERLAPS_PREVIOUS_PERIOD` | `startDate` would overlap or precede the prior period’s window. |
| 400 | `PERIOD_KEY_CONFLICT` | Another period already has this `key`. |
| *(same as update-end-date)* | `END_BEFORE_START`, `END_DATE_TOO_SOON`, `PERIOD_NOT_ACTIVE`, … | |

---

## Admin: `POST /api/v1/periods/admin/force-lock`

**Auth:** session + org admin role (`owner`, `admin`, or `nodal`).

**Purpose:** Run a **full early close** in one step:

1. Set period **`locked`** → promote all **`draft`** KPI entries for this period to **`submitted`**, then generate KPI report snapshot (same as cron at lock).
2. Set **`endDate`** to the **UTC calendar day of report generation** (“today” in UTC when the step runs).
3. Set period **`closed`**.
4. **Create** the next period as **`active`**, with `startDate = previous endDate + 1` UTC day and `endDate` from **`frequencyMonths`** (same month arithmetic as the first period).

So the next cycle always continues from the **last** `endDate` in the chain.

### Request

- **Body:** `{ "periodId": "<ObjectId string>" }`

### Success

- **200** — `{ "closedPeriod": { ... }, "nextPeriod": { ... }, "message": "..." }`

### Errors

| Status | `data.title` | When |
|--------|----------------|------|
| 400 | `NO_ACTIVE_ORGANIZATION` | No active org. |
| 400 | `INVALID_ID` | Invalid org or period id. |
| 403 | `ORG_ADMIN_REQUIRED` | Role is not owner/admin/nodal. |
| 404 | `PERIOD_NOT_FOUND` | Period not in this org. |
| 400 | `PERIOD_NOT_ACTIVE` | Period is not `active`. |

---

## Admin: `POST /api/v1/periods/admin/generate-reports`

**Auth:** session + org admin role (`owner`, `admin`, or `nodal`).

**Purpose:** **Generate or retry** KPI report snapshot for a period that is already **`locked`** or **`closed`**. Use **`force: true`** to delete the existing report run and aggregates for that period and rebuild (e.g. cron failed, bad data corrected in entries).

### Request

- **Body:** `{ "periodId": "<ObjectId string>", "force": optional boolean }`

### Success

- **200** — `{ "run": { ... }, "message": "..." }`

### Errors

| Status | `data.title` | When |
|--------|----------------|------|
| 400 | `NO_ACTIVE_ORGANIZATION` | No active org. |
| 403 | `ORG_ADMIN_REQUIRED` | Role is not owner/admin/nodal. |
| 404 | `PERIOD_NOT_FOUND` | Period not in this org. |
| 400 | `REPORT_GENERATION_REQUIRES_LOCKED_OR_CLOSED` | Period is still `active`; use `admin/force-lock` first. |

---

## Automation (not HTTP): daily cron

Runs **daily at 23:59** server time (`runDailyMaintenance`). For each started org it uses the single **`active`** period row (bootstrapped via `ensureCurrentPeriod` if missing):

- Let **`endDate`** be that period’s stored inclusive end (UTC). **`nextStartDate` = the UTC calendar day after `endDate`** (midnight UTC).
- **Lock:** while `now` is in `[nextStartDate - lockingPeriodDays, nextStartDate)`, the **active** period becomes **`locked`**. All **`draft`** KPI entries for that period are set to **`submitted`** (`entries.service` `submitAllDraftsForPeriod`), then report generation runs once (idempotent).
- **Close / roll:** when `now` ≥ `nextStartDate`, the current period is **`closed`** (if still **active**, it is locked, drafts auto-submitted, report generated, then closed) and the **next** period is upserted as **`active`**. The next period’s **`endDate`** is computed from **`startDate = previous endDate + 1`** using **`frequencyMonths`** and the **same calendar day-of-month as that `startDate`** (`nextPeriodBoundsFromChainEnd`), so one monthly step stays ~one month even when the previous **`endDate`** was irregular (e.g. force-lock on the 31st → next start the 1st → end the last day of April, not two calendar months later).
- **No duplicate active rows:** while the current row is **`locked`** and not yet **`closed`**, maintenance treats that row as **`current`** (not “missing active”). **`ensureCurrentPeriod`** does not insert another **`active`** period in that window; otherwise a second active period could appear beside the one created at close/roll.

Admins can change the **active** period’s `endDate` via **`POST /admin/update-end-date`**; that shifts `nextStartDate` for lock and roll without rewriting `startedAt`.

---

## Related modules

- **Entries:** draft/submit KPI data against a period; locking blocks changes.
- **Reports:** generated around lock; visibility rules align with period **closed** stage in the reports module.
