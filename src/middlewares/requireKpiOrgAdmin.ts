import { NextFunction, Request, Response } from 'express';
import APIError from '@/configs/errors/APIError';

/** Roles that may manage KPI period admin actions (aligned with better-auth organization plugin). */
const KPI_ORG_ADMIN_ROLES = new Set(['owner', 'admin', 'nodal']);

/**
 * Requires an active org in session and a privileged org role (`owner`, `admin`, or `nodal`).
 */
export function requireKpiOrgAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.session?.activeOrganizationId) {
    throw new APIError({
      STATUS: 400,
      TITLE: 'NO_ACTIVE_ORGANIZATION',
      MESSAGE: 'No active organization in session',
    });
  }
  const role = req.session.activeOrganizationRole;
  if (!role || !KPI_ORG_ADMIN_ROLES.has(role)) {
    throw new APIError({
      STATUS: 403,
      TITLE: 'ORG_ADMIN_REQUIRED',
      MESSAGE: 'This action requires organization owner, admin, or nodal role.',
    });
  }
  next();
}
