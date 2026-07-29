# Staff KPI self-view API

**Base path:** `/api/v1/staff`

Read-only endpoints for org role **`staff`**. Resolves the caller via **`tb_employees.userId = session.userId`**.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/me` | Profile: name, empId, department, departmentRole |
| `GET` | `/periods` | Closed periods that have a department ranking for this employee |
| `GET` | `/periods/:periodId/summary` | Own department (+ overall if present) score/rank; period must be **closed** |
| `GET` | `/periods/:periodId/cohort` | Same department + role: **self**, **top N**, **bottom N**, cohort size. Query: `topN?`, `bottomN?` (default 3) |

Data source: **`kpi_report_rankings`** (`scope=department` for cohort).
