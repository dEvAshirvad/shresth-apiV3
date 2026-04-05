# Background jobs API

**Base path:** `/api/v1/jobs`

Heavy KPI operations (WhatsApp performance batch, nodal bulk sync, nodal bulk invitations) are **queued in Redis (BullMQ)** by default so the API returns quickly. A **separate worker process** must run (`pnpm worker:dev` or `pnpm start:worker`).

---

## Environment

| Variable | Description |
|----------|-------------|
| `BACKGROUND_JOBS_SYNC` | If **`true`**, queued endpoints run **inline** (slower HTTP, no worker). If **unset**: **`development`** / **`test`** default to **`true`**; **`production`** defaults to **`false`** (BullMQ worker required). |
| `REDIS_*` | Same Redis as the rest of the app (`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`). |

---

## `GET /api/v1/jobs/:jobId`

**Auth:** session with **`activeOrganizationId`** and org role **`owner`**, **`admin`**, or **`nodal`** (`requireKpiOrgAdmin`).

Returns BullMQ job metadata when the job’s payload **`organizationId`** matches the active org.

**Success (`200`):** `job` object including:

| Field | Description |
|-------|-------------|
| `state` | `waiting` \| `active` \| `completed` \| `failed` \| `delayed` \| `paused` |
| `returnvalue` | Result of the job when **`completed`** (e.g. WhatsApp batch summary, nodal sync counts, invitation results). |
| `failedReason` | When **`failed`**. |
| `finishedOn`, `processedOn`, `timestamp` | Milliseconds epoch from BullMQ. |

**`400`** — `BACKGROUND_JOBS_SYNC=true` (no queue state).

**`404`** — unknown job id or job belongs to another organization.

**`503`** — Redis / queue unavailable.

---

## Related

- `reports.api.md` — `POST .../whatsapp/send` queues when not in sync mode.  
- `nodal.api.md` — `POST .../sync-from-org-members` and `POST .../send-invitation-to-rest-nodals` queue when not in sync mode.
