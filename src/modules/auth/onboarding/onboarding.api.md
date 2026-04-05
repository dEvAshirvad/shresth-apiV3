# Onboarding — API Reference

**Module:** Auth · **Mount:** `/api/v1/onboarding`

---

## Overview

Single endpoint to mark the authenticated user as **onboarded** after they have been linked to at least one organization membership. This is intentionally minimal: it does not create orgs, COA, or journals — it only flips `isOnboarded` on the user record when safe to do so.

### Design decisions

1. **Idempotency is rejected.** If `user.isOnboarded` is already true, the API returns **400** (not 200).
2. **Membership prerequisite.** A row must exist in `Member` for `userId`; otherwise **404**.
3. **No request body** — the action is fully determined by session + DB state.

---

## Authentication

Requires Better Auth session with `req.user`. Unauthenticated requests are not handled specially by this handler (may fail earlier in the stack).

---

## Routes

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/v1/onboarding/complete-onboarding` | Set `isOnboarded: true` |

---

## `POST /complete-onboarding`

### Request

Empty body.

### Responses

| HTTP | When |
| ---- | ---- |
| 200 | User was not onboarded; now updated. `data.message` confirms success |
| 400 | User already onboarded |
| 404 | No `Member` document for this user |

### Example

```json
// Response 200
{
  "success": true,
  "status": 200,
  "data": {
    "message": "Onboarding completed successfully"
  },
  "timestamp": "…",
  "requestId": "…"
}
```

---

## Related code

- Router: `onboarding.router.ts`
- Handler: `onboarding.handler.ts`
