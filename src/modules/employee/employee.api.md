# Employee API

**Base path:** `/api/v1/employee`

---

## What this module is

Employees are **people records** with `name`, `phone`, optional `email`, **`department`**, **`departmentRole`**, and (after provision) **`empId`** / **`userId`** / **`memberId`**.

**Preferred auth path:** provision **empId + password** (Better Auth username, org role **`staff`**). No invitations / onboarding for new staff.

- **Create / import / `POST /provision-credentials`** create credentials (CSV/UI only; no WhatsApp).
- **`POST /download-all-credentials`** rotates passwords and returns slim CSV rows.
- **`POST /:id/reset-password`** rotates one employee.

**Legacy (soft-deprecated):** **`POST /send-invitation-to-rest-employees`**, **`POST /sync-from-org-members`**, and **`POST /:email/attach-user-id-and-member-id`** remain for older Google-invite flows.

## Why it exists

KPI templates target **roles within departments**; entries snapshot `roleSnapshot` from these records. Phone-based upsert supports **bulk import**. Staff log in with empId + password and view their own closed-period KPI under `/api/v1/staff`.

---

## Auth and scope

- Most handlers require **`req.session.activeOrganizationId`**.
- Create/import/provision/download scope employees via **department → organizationId**.

---

## All routes

| Method   | Path                                   | Purpose                                                                                          |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/`                                    | Paginated list + search (`name` / `email` / `phone` / `empId`).                                  |
| `GET`    | `/import/template`                     | Download CSV/XLSX template.                                                                      |
| `POST`   | `/import`                              | Bulk upsert by phone; provisions credentials; returns **`credentials[]`**.                       |
| `POST`   | `/provision-credentials`               | Provision empId + password for unlinked employees (`departmentId?`).                             |
| `POST`   | `/download-all-credentials`            | Rotate/provision all (optional `departmentId`); `?format=csv` for file.                          |
| `POST`   | `/:id/reset-password`                  | Rotate password for one employee.                                                                |
| `POST`   | `/sync-from-org-members`               | **Legacy.** Match email → user → member.                                                         |
| `POST`   | `/:email/attach-user-id-and-member-id` | **Legacy.** Explicit link.                                                                       |
| `GET`    | `/:id`                                 | Single employee (populated).                                                                     |
| `POST`   | `/`                                    | Create + provision credentials.                                                                  |
| `PUT`    | `/:id`                                 | Update employee.                                                                                 |
| `DELETE` | `/:id`                                 | Delete employee.                                                                                 |
| `POST`   | `/send-invitation-to-rest-employees`   | **Legacy.** Create/resend invitations.                                                           |

## EmpId format

`{orgPrefix}_{deptShort}_{NNNN}` — e.g. `rai8445_mgnrega_0001`. Globally unique Better Auth username. Synthetic email `{empId}@staff.local`.
