import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import APIError from '@/configs/errors/APIError';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import { StaffKpiService } from './staff.services';

export class StaffHandler {
  static async getMe(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    const userId = String(req.session?.userId || req.user?.id || '');
    if (!organizationId || !isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    if (!userId) {
      throw new APIError({
        STATUS: 401,
        TITLE: 'UNAUTHORIZED',
        MESSAGE: 'Not authenticated',
      });
    }

    const me = await StaffKpiService.getMe({
      userId,
      organizationId,
      role: req.session?.activeOrganizationRole,
    });

    Respond(res, { me, message: 'OK' }, 200);
  }

  static async listPeriods(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    const userId = String(req.session?.userId || req.user?.id || '');
    if (!organizationId || !isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    if (!userId) {
      throw new APIError({
        STATUS: 401,
        TITLE: 'UNAUTHORIZED',
        MESSAGE: 'Not authenticated',
      });
    }

    const result = await StaffKpiService.listPeriods({
      userId,
      organizationId,
      role: req.session?.activeOrganizationRole,
    });

    Respond(res, { ...result, message: 'OK' }, 200);
  }

  static async getPeriodSummary(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    const userId = String(req.session?.userId || req.user?.id || '');
    const periodId = paramStr(req.params.periodId);
    if (!organizationId || !isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    if (!userId) {
      throw new APIError({
        STATUS: 401,
        TITLE: 'UNAUTHORIZED',
        MESSAGE: 'Not authenticated',
      });
    }

    const summary = await StaffKpiService.getPeriodSummary({
      userId,
      organizationId,
      periodId,
      role: req.session?.activeOrganizationRole,
    });

    Respond(res, { summary, message: 'OK' }, 200);
  }

  static async getPeriodCohort(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    const userId = String(req.session?.userId || req.user?.id || '');
    const periodId = paramStr(req.params.periodId);
    if (!organizationId || !isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    if (!userId) {
      throw new APIError({
        STATUS: 401,
        TITLE: 'UNAUTHORIZED',
        MESSAGE: 'Not authenticated',
      });
    }

    const topN = req.query.topN ? Number(req.query.topN) : undefined;
    const bottomN = req.query.bottomN ? Number(req.query.bottomN) : undefined;

    const cohort = await StaffKpiService.getPeriodCohort({
      userId,
      organizationId,
      periodId,
      role: req.session?.activeOrganizationRole,
      topN: Number.isFinite(topN) ? topN : undefined,
      bottomN: Number.isFinite(bottomN) ? bottomN : undefined,
    });

    Respond(res, { cohort, message: 'OK' }, 200);
  }
}
