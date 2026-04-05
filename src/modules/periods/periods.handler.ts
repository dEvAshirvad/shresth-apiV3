import { Request, Response } from 'express';
import APIError from '@/configs/errors/APIError';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import { KpiPeriodService } from './periods.service';
import { KpiReportService } from '../reports/reports.service';

export class KpiPeriodHandler {
  static async listPeriods(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const { page, limit, status } = req.query as {
      page?: string;
      limit?: string;
      status?: 'active' | 'locked' | 'closed';
    };

    const result = await KpiPeriodService.listPeriods(organizationId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
    });

    return Respond(
      res,
      { ...result, message: 'KPI periods fetched successfully' },
      200
    );
  }

  static async getPeriod(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const id = paramStr(req.params.id);
    const period = await KpiPeriodService.getPeriodById(organizationId, id);
    if (!period) {
      return Respond(res, { message: 'KPI period not found' }, 404);
    }
    return Respond(res, { period, message: 'KPI period fetched successfully' }, 200);
  }

  static async getConfig(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const config = await KpiPeriodService.getPeriodConfig(organizationId);
    return Respond(
      res,
      {
        config,
        message: config
          ? 'KPI period configuration fetched successfully'
          : 'No KPI period configuration for this organization yet',
      },
      200
    );
  }

  static async start(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const result = await KpiPeriodService.start(organizationId);
    return Respond(
      res,
      {
        ...result,
        message: 'KPI period system started and initial period generated',
      },
      201
    );
  }

  static async updateConfig(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const config = await KpiPeriodService.updateConfig(organizationId, req.body);
    return Respond(
      res,
      { config, message: 'KPI period configuration updated successfully' },
      200
    );
  }

  static async adminForceLock(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    const { periodId, reportDate } = req.body as { periodId: string; reportDate?: string };
    const { closedPeriod, nextPeriod } = await KpiPeriodService.adminForceLockPeriod(
      organizationId,
      periodId,
      { reportDate }
    );
    return Respond(
      res,
      {
        closedPeriod,
        nextPeriod,
        message:
          'Period locked, reports generated, endDate set to report day (UTC), period closed, and next period created',
      },
      200
    );
  }

  static async adminUpdateEndDate(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    const { periodId, endDate } = req.body as { periodId: string; endDate: string | Date };
    const period = await KpiPeriodService.adminUpdateEndDate(organizationId, periodId, endDate);
    return Respond(
      res,
      {
        period,
        message: 'Period end date updated; automation uses this endDate for lock and next cycle',
      },
      200
    );
  }

  static async adminUpdatePeriodDates(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    const body = req.body as {
      periodId: string;
      startDate?: string | Date;
      endDate?: string | Date;
    };
    const period = await KpiPeriodService.adminUpdatePeriodDates(organizationId, body.periodId, {
      startDate: body.startDate,
      endDate: body.endDate,
    });
    return Respond(
      res,
      {
        period,
        message:
          'Period date(s) updated; automation uses the active period bounds for lock and the next cycle',
      },
      200
    );
  }

  static async adminGenerateReports(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    const { periodId, force } = req.body as { periodId: string; force?: boolean };
    const run = await KpiReportService.generateReportsForPeriodAdmin(organizationId, periodId, {
      force,
    });
    return Respond(
      res,
      {
        run,
        message: force
          ? 'KPI report snapshot regenerated'
          : 'KPI report snapshot generated or already present',
      },
      200
    );
  }
}

