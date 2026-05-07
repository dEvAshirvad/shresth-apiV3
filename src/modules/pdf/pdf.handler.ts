import { Request, Response } from 'express';
import APIError from '@/configs/errors/APIError';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import { ReportZipService } from '../reports/reportZip.service';

export class PdfHandler {
  static async getDepartmentPdf(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId || String(req.query.organizationId || '');
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const departmentId = paramStr(req.params.departmentId);
    const periodId = req.query.periodId
      ? String(req.query.periodId).trim()
      : undefined;

    const result = await ReportZipService.generateDepartmentPdf({
      organizationId,
      departmentId,
      periodId,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.send(result.buffer);
  }

  static async getDepartmentPdfMeta(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId || String(req.query.organizationId || '');
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const departmentId = paramStr(req.params.departmentId);
    const periodId = req.query.periodId
      ? String(req.query.periodId).trim()
      : undefined;
    const result = await ReportZipService.generateDepartmentPdf({
      organizationId,
      departmentId,
      periodId,
    });
    return Respond(
      res,
      {
        periodId: result.periodId,
        periodLabel: result.periodLabel,
        departmentName: result.departmentName,
        fileName: result.fileName,
      },
      200
    );
  }

  static async getAllDepartmentsZip(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId || String(req.query.organizationId || '');
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
