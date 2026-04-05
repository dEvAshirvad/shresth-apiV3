import { Request, Response } from 'express';
import APIError from '@/configs/errors/APIError';
import env from '@/configs/env';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import { enqueueWhatsAppSend, KPI_QUEUED_JOB_HINT } from '@/jobs/kpiBackground.queue';
import { HttpErrorStatusCode } from '@/types/errors/errors.types';
import { KpiReportService } from './reports.service';
import { ReportZipService } from './reportZip.service';
import { WhatsappPerformanceService } from './whatsappPerformance.service';

export class KpiReportHandler {
  static async list(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const reports = await KpiReportService.listReports(organizationId);
    return Respond(res, { reports, message: 'Reports fetched successfully' }, 200);
  }

  static async getSummary(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const periodId = paramStr(req.params.periodId);
    const run = await KpiReportService.getReportSummary(organizationId, periodId);
    if (!run) return Respond(res, { message: 'Report not found' }, 404);
    return Respond(res, { run, message: 'Report summary fetched successfully' }, 200);
  }

  static async departmentRoleStats(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const periodId = paramStr(req.params.periodId);
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;
    const stats = await KpiReportService.getDepartmentRoleStats(
      organizationId,
      periodId,
      departmentId
    );
    if (!stats) return Respond(res, { message: 'Report not found' }, 404);
    return Respond(res, { stats, message: 'Department role stats fetched' }, 200);
  }

  static async ranking(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const periodId = paramStr(req.params.periodId);
    const scope = String(req.params.scope);
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page)) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit)) : 50;

    if (scope !== 'overall' && scope !== 'department') {
      throw new APIError({ STATUS: 400, TITLE: 'INVALID_SCOPE', MESSAGE: 'scope must be overall|department' });
    }
    if (scope === 'department' && !departmentId) {
      throw new APIError({ STATUS: 400, TITLE: 'MISSING_DEPARTMENT', MESSAGE: 'departmentId is required for department scope' });
    }

    const result = await KpiReportService.getRanking({
      organizationId,
      periodId,
      scope: scope as any,
      departmentId,
      page,
      limit,
    });
    if (!result) return Respond(res, { message: 'Report not found' }, 404);
    return Respond(res, { ...result, message: 'Ranking fetched' }, 200);
  }

  static async listWhatsAppSends(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const periodId = paramStr(req.params.periodId);
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const status = req.query.status ? String(req.query.status) : undefined;
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;

    const result = await WhatsappPerformanceService.listSends({
      organizationId,
      periodId,
      page,
      limit,
      status: status as any,
      departmentId,
    });
    return Respond(res, { ...result, message: 'WhatsApp send records fetched' }, 200);
  }

  static async sendWhatsAppPerformance(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const periodId = paramStr(req.params.periodId);
    const body = req.body as {
      dryRun?: boolean;
      departmentId?: string;
      delayMs?: number;
      resend?: boolean;
    };
    const user = req.user as { id?: string } | undefined;

    const payload = {
      organizationId,
      periodId,
      dryRun: Boolean(body.dryRun),
      departmentId: body.departmentId,
      delayMs: typeof body.delayMs === 'number' ? body.delayMs : undefined,
      resend: Boolean(body.resend),
      triggeredByUserId: user?.id,
    };

    if (env.BACKGROUND_JOBS_SYNC) {
      const data = await WhatsappPerformanceService.sendPerformanceBatch(payload);
      return Respond(res, { mode: 'sync', ...data }, 200);
    }

    try {
      const { jobId } = await enqueueWhatsAppSend(payload);
      return Respond(
        res,
        {
          mode: 'queued',
          jobId,
          message:
            'WhatsApp batch queued. Poll GET /api/v1/jobs/:jobId for completion (same org session).',
          hint: KPI_QUEUED_JOB_HINT,
        },
        202
      );
    } catch (err) {
      throw new APIError({
        STATUS: HttpErrorStatusCode.SERVICE_UNAVAILABLE,
        TITLE: 'JOB_QUEUE_UNAVAILABLE',
        MESSAGE:
          'Could not enqueue job. Ensure Redis is running and start the worker (`pnpm worker:dev`), or set BACKGROUND_JOBS_SYNC=true to run inline.',
        META: { cause: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  static async downloadDepartmentZip(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    const periodId = paramStr(req.params.periodId);
    const forceRegenerate =
      String(req.query.force || '').toLowerCase() === 'true' ||
      String(req.query.force || '').toLowerCase() === '1';
    const artifact = await ReportZipService.getOrCreateDepartmentReportZip({
      organizationId,
      periodId,
      notifyOwnersAndAdmins: false,
      generatedBy: 'manual',
      forceRegenerate,
    });

    const filePath = String((artifact as any).filePath || '');
    const fileName = String((artifact as any).fileName || 'department-reports.zip');
    if (!filePath) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'REPORT_ZIP_NOT_FOUND',
        MESSAGE: 'Department report ZIP was not found',
      });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.sendFile(filePath);
  }
}

