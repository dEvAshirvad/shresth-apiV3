import { NextFunction, Request, Response } from 'express';
import APIError from '@/configs/errors/APIError';

const OWNER_OR_ADMIN = new Set(['owner', 'admin']);

/**
 * Requires an active org in session and org role **owner** or **admin** (not nodal or staff).
 */
export function requireOrgOwnerOrAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!req.session?.activeOrganizationId) {
    throw new APIError({
      STATUS: 400,
      TITLE: 'NO_ACTIVE_ORGANIZATION',
      MESSAGE: 'No active organization in session',
    });
  }
  const role = req.session.activeOrganizationRole;
  if (!role || !OWNER_OR_ADMIN.has(role)) {
    throw new APIError({
      STATUS: 403,
      TITLE: 'ORG_OWNER_OR_ADMIN_REQUIRED',
      MESSAGE:
        'This action requires organization owner or admin role.',
    });
  }
  next();
}
