# Employee API

**Base path:** `/api/v1/employee`

---

## What this module is

Employees are **people records** with `name`, `phone`, optional `email`, **`department`** (ObjectId), and **`departmentRole`** (free-text role used for template matching). They may link to **`userId`**, **`memberId`**, and **`invitationId`** as onboarding progresses.

**Invitation linking:** Use **`POST /send-invitation-to-rest-employees`** to create pending invitations and set **`invitationId`** on each row that gets an email. After someone has joined the org (user + member exist), use **`POST /sync-from-org-members`** to backfill **`userId`** / **`memberId`** by matching **email → user → member**, or **`POST /:id/attach-user-id-and-member-id`** with explicit **`userId`** and **`memberId`** when you already know them (e.g. automation right after accept).

## Why it exists

KPI templates target **roles within departments**; entries snapshot `roleSnapshot` from these records. Phone-based upsert supports **bulk import** and invitation flows without duplicating users.

---

## Auth and scope

- Most handlers rely on session + `req.user` where invitations are sent.
- **`send-invitation-to-rest-employees`** requires a valid `req.session.activeOrganizationId` and valid `departmentId` (throws `NO_ACTIVE_ORGANIZATION` / `INVALID_DEPARTMENT_ID` when invalid).
- List/get/update/delete **do not** currently filter by `organizationId` in `EmployeeService`; ensure your product layer restricts access (e.g. only nodal/admin) or extend queries to scope by org via department.

---

## All routes

| Method   | Path                                 | Purpose                                                                                                             |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/`                                  | Paginated list + search.                                                                                            |
| `GET`    | `/import/template`                   | Download CSV/XLSX template.                                                                                         |
| `POST`   | `/import`                            | Bulk upsert by phone for a department (`multipart` + JSON body).                                                    |
| `POST`   | `/sync-from-org-members`             | Match **email** to **user**, then **member** for the active org; set `userId` + `memberId` on rows in a department. |
| `POST`   | `/:id/attach-user-id-and-member-id`  | Set **`userId`** and **`memberId`** on one employee (validates org + member).                                       |
| `GET`    | `/:id`                               | Single employee (populated).                                                                                        |
| `POST`   | `/`                                  | Create employee.                                                                                                    |
| `PUT`    | `/:id`                               | Update employee.                                                                                                    |
| `DELETE` | `/:id`                               | Delete employee.                                                                                                    |
| `POST`   | `/send-invitation-to-rest-employees` | Create/resend invitations and attach **`invitationId`** for staff in a department.                                  |

---

## `GET /api/v1/employee`

**Description (2 lines):** Paginated employees with **`department`**, **`invitationId`**, and **`userId`** populated. Search matches `name`, `email`, or `phone` (regex).

### Request

- **Query:** `page`, `limit` (defaults `1` / `10`), `search` (optional).

### Success response

- **HTTP:** `200`
- **`data`:** `{ docs[], total, page, limit, totalPages, hasNextPage, hasPreviousPage, message }`

---

## `GET /api/v1/employee/import/template`

**Description (2 lines):** File download for bulk employee import columns: `name`, `phone`, `email`, `departmentRole`.

### Request

- **Query:** `format` — `csv` (default) or `xlsx`.

### Success response

- **HTTP:** `200` — CSV or XLSX attachment (`employees-import-template.*`).

---

## `POST /api/v1/employee/import`

**Description (2 lines):** **`multipart/form-data`** with field **`file`**. JSON body must include **`departmentId`** (validated). Rows upsert by **`phone`** into that department.

### Request

- **Content-Type:** `multipart/form-data`
- **Body (JSON fields alongside file):** `{ "departmentId": "<ObjectId>" }`
- **File:** first sheet / CSV with columns: `name`, `phone` required; `email`, `department`, `departmentRole` optional (see handler normalization).

### Success response

- **HTTP:** `200` — `{ insertedCount, updatedCount, totalProcessed, message }`

### Errors

| HTTP | When                                                                 |
| ---- | -------------------------------------------------------------------- |
| 400  | Missing file, bad file type, empty rows (`message` in `data`).       |
| 400  | `VALIDATION_ERROR` if `departmentId` missing/invalid in body schema. |

---

## `GET /api/v1/employee/:id`

**Description (2 lines):** Returns one employee by id with **`department`**, **`invitationId`**, **`userId`** populated.

### Success response

- **HTTP:** `200` — `{ employee, message }`
- **HTTP:** `404` — `{ message: 'Employee not found' }`

---

## `POST /api/v1/employee`

**Description (2 lines):** Creates an employee. **`department`** must be a valid ObjectId string or the service throws **`INVALID_DEPARTMENT_ID`**.

### Request

- **Body (`employeeDepartmentCreateZodSchema`):**

| Field            | Type   | Notes                              |
| ---------------- | ------ | ---------------------------------- |
| `name`           | string | Required.                          |
| `phone`          | string | Required; unique in collection.    |
| `email`          | string | Optional; email format if present. |
| `department`     | string | Required; department ObjectId.     |
| `departmentRole` | string | Required.                          |

### Success response

- **HTTP:** `201` — `{ employee, message }`

### Errors

| `TITLE`                 | When                               |
| ----------------------- | ---------------------------------- |
| `INVALID_DEPARTMENT_ID` | `department` not a valid ObjectId. |
| `VALIDATION_ERROR`      | Zod validation failed.             |

---

## `PUT /api/v1/employee/:id`

**Description (2 lines):** Partial update; same field types as create, all optional in schema.

### Success response

- **HTTP:** `200` — `{ employee, message }` or **404**.

---

## `DELETE /api/v1/employee/:id`

**Description (2 lines):** Deletes by id; returns deleted document.

### Success response

- **HTTP:** `200` — `{ employee, message }` or **404**.

---

## `POST /api/v1/employee/:email/attach-user-id-and-member-id`

**Description:** Sets **`userId`** and **`memberId`** on a single employee. Confirms the employee’s **department** belongs to **`req.session.activeOrganizationId`**, and that a **member** exists with `_id === memberId` and `(organizationId, userId)` for that org. If the employee has an **email**, it must match the **user**’s email.

### Request

- **Params:** `email` — employee email.
- **Body (`attachUserIdMemberIdZodSchema`):** `{ "userId": "<ObjectId>", "memberId": "<ObjectId>" }`
- **Session:** `activeOrganizationId` required.

### Success response

- **HTTP:** `200` — `{ employee, message }`

### Errors

| `TITLE`                   | HTTP | When                                           |
| ------------------------- | ---- | ---------------------------------------------- |
| `NO_ACTIVE_ORGANIZATION`  | 400  | Missing/invalid active org.                    |
| `INVALID_IDS`             | 400  | Bad ObjectId.                                  |
| `EMPLOYEE_NOT_FOUND`      | 404  | Unknown employee id.                           |
| `EMPLOYEE_NO_DEPARTMENT`  | 400  | Employee has no department.                    |
| `DEPARTMENT_ORG_MISMATCH` | 403  | Department not in this organization.           |
| `MEMBER_MISMATCH`         | 400  | No member for `(org, userId, memberId)`.       |
| `EMAIL_USER_MISMATCH`     | 400  | User email ≠ employee email when email is set. |

---

## `POST /api/v1/employee/sync-from-org-members`

**Description:** Scans **all employees** in the given **`departmentId`** (must belong to **`req.session.activeOrganizationId`**). For each row with an **email**, looks up a **user** by that email, then a **member** with `(organizationId, userId)` for the active org. When both exist, sets **`userId`** and **`memberId`** on the employee. Skips rows that already have both ids, rows without email, users not in the org, or when the stored **`userId`** conflicts with the user resolved from email.

### Request

- **Body:** `{ "departmentId": "<ObjectId>" }`
- **Session:** `activeOrganizationId` required.

### Success response

- **HTTP:** `200`
- **`data`:** `{ linked: number, skipped: Array<{ employeeId, email?, reason }>, message }`

### Errors

| `TITLE`                  | HTTP | When                                 |
| ------------------------ | ---- | ------------------------------------ |
| `NO_ACTIVE_ORGANIZATION` | 400  | Missing/invalid active org.          |
| `INVALID_DEPARTMENT_ID`  | 400  | Bad `departmentId`.                  |
| `DEPARTMENT_NOT_FOUND`   | 404  | Department not in this organization. |

---

## `POST /api/v1/employee/send-invitation-to-rest-employees`

**Description (2 lines):** For a given **`departmentId`**, emails **pending** invitations (resend) and creates/sends **new** invitations for staff without `userId` and with a valid email. Returns per-employee **`errors`** when something fails (SMTP, missing email, etc.).

### Request

- **Body:** `{ "departmentId": "<ObjectId>" }`
- **Auth:** `req.user` required (`INVITER_REQUIRED` if missing).

### Success response

- **HTTP:** `200`

```json
{
  "employees": [],
  "errors": [{ "employeeId": "", "email": "", "message": "" }],
  "message": "Invitations sent successfully | Some invitations could not be sent; see errors | No invitations could be sent"
}
```

(`employees` holds successfully processed rows; shape follows service.)

### Errors

| `TITLE`                  | HTTP | When                                    |
| ------------------------ | ---- | --------------------------------------- |
| `NO_ACTIVE_ORGANIZATION` | 400  | Missing/invalid `activeOrganizationId`. |
| `INVALID_DEPARTMENT_ID`  | 400  | Bad `departmentId`.                     |
| `INVALID_IDS`            | 400  | Service-level id validation.            |
| `INVITER_REQUIRED`       | 401  | No `req.user.id`.                       |

---

## Related

- **Templates** validate that a **role** exists among employees in a department.
- **Entries** use `employeeId` and snapshot `departmentRole`.
- **`/api/v1/organization/invitations/import`** — bulk CSV **org admin** invites only (`role: admin`). Nodal invites use **`/api/v1/nodal`**.
- **`/api/v1/nodal`** — **org-scoped** nodal rows (no department on the document); **`POST /sync-from-org-members`** has **no body**; **`POST /send-invitation-to-rest-nodals`** has **no body**; attach is **`POST /:email/attach-user-id-and-member-id`** (not `/:id`). Invitations use org role **`nodal`**. See **`nodal.api.md`**.
