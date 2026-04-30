import { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import APIError from '@/configs/errors/APIError';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import {
  KpiEntryService,
  formatKpiEntryImportRemarkHeader,
  formatKpiEntryImportValueHeader,
} from './entries.service';
import { EmployeeModal } from '../employee/employee.model';
import { KpiTemplateModel } from '../templates/templates.model';
import { DepartmentModel } from '../departments/departments.model';

const NODAL_ROLES = new Set(['nodal', 'nodals']);

async function getScopedDepartmentIdsForNodal(
  organizationId: string,
  memberId: string
) {
  const departments = await DepartmentModel.find({
    organizationId,
    assignedNodal: memberId,
  } as any)
    .select('_id')
    .lean();
  return departments.map((d: any) => String(d._id));
}

async function enforceNodalDepartmentAccess(
  req: Request,
  organizationId: string,
  departmentId: string
) {
  const role = String(req.session?.activeOrganizationRole || '').toLowerCase();
  if (!NODAL_ROLES.has(role)) return;
  const memberId = String(req.session?.memberId || '');
  if (!memberId) {
    throw new APIError({
      STATUS: 403,
      TITLE: 'NODAL_MEMBER_REQUIRED',
      MESSAGE: 'Nodal member context is missing in session',
    });
  }
  const scopedDepartmentIds = await getScopedDepartmentIdsForNodal(
    organizationId,
    memberId
  );
  if (!scopedDepartmentIds.includes(String(departmentId))) {
    throw new APIError({
      STATUS: 403,
      TITLE: 'NODAL_DEPARTMENT_FORBIDDEN',
      MESSAGE: 'You can only access departments assigned to you.',
    });
  }
}

function sendImportLayoutDownload(
  res: Response,
  header: string[],
  rows: Record<string, unknown>[],
  format: string,
  filenameBase: string
) {
  if (format === 'xlsx') {
    const sheet = XLSX.utils.json_to_sheet(rows, { header });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Entries');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  const escapeCsvField = (s: string) => {
    const t = String(s);
    if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  };
  const csvLines = [
    header.map(escapeCsvField).join(','),
    ...rows.map((r) =>
      header
        .map((h) => {
          const v = r[h] ?? '';
          const s = String(v).replace(/"/g, '""');
          return `"${s}"`;
        })
        .join(',')
    ),
  ];
  const csv = `${csvLines.join('\n')}\n`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  return res.send(csv);
}

export class KpiEntryHandler {
  static async upsertDraft(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const entry = await KpiEntryService.upsertDraft(req.body, organizationId);
    return Respond(res, { entry, message: 'KPI entry draft saved' }, 201);
  }

  static async submit(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const id = paramStr(req.params.id);
    const entry = await KpiEntryService.submitEntry(id, organizationId);
    if (!entry) return Respond(res, { message: 'Entry not found' }, 404);
    return Respond(res, { entry, message: 'KPI entry submitted' }, 200);
  }

  static async bulkSubmit(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }
    const result = await KpiEntryService.bulkSubmitEntries(req.body.entryIds, organizationId);
    return Respond(res, { ...result, message: 'Bulk submit completed' }, 200);
  }

  static async getEntry(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const id = paramStr(req.params.id);
    const entry = await KpiEntryService.getEntry(id, organizationId);
    if (!entry) return Respond(res, { message: 'Entry not found' }, 404);

    const role = String(req.session?.activeOrganizationRole || '').toLowerCase();
    if (NODAL_ROLES.has(role)) {
      const memberId = String(req.session?.memberId || '');
      if (!memberId) {
        throw new APIError({
          STATUS: 403,
          TITLE: 'NODAL_MEMBER_REQUIRED',
          MESSAGE: 'Nodal member context is missing in session',
        });
      }
      const scopedDepartmentIds = await getScopedDepartmentIdsForNodal(
        organizationId,
        memberId
      );
      if (!scopedDepartmentIds.includes(String((entry as any).departmentId || ''))) {
        return Respond(res, { message: 'Entry not found' }, 404);
      }
    }

    return Respond(res, { entry, message: 'Entry fetched successfully' }, 200);
  }

  static async getEntries(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const { page, limit, employeeId, periodId, templateId } = req.query;
    const role = String(req.session?.activeOrganizationRole || '').toLowerCase();
    let departmentIds: string[] | undefined;
    if (NODAL_ROLES.has(role)) {
      const memberId = String(req.session?.memberId || '');
      if (!memberId) {
        throw new APIError({
          STATUS: 403,
          TITLE: 'NODAL_MEMBER_REQUIRED',
          MESSAGE: 'Nodal member context is missing in session',
        });
      }
      departmentIds = await getScopedDepartmentIdsForNodal(organizationId, memberId);
    }

    const result = await KpiEntryService.getEntries(
      {
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 10,
        employeeId: (employeeId as string) || undefined,
        periodId: (periodId as string) || undefined,
        templateId: (templateId as string) || undefined,
        departmentIds,
      },
      organizationId
    );
    return Respond(res, { ...result, message: 'Entries fetched successfully' }, 200);
  }

  static async deleteDraft(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({ STATUS: 400, TITLE: 'NO_ACTIVE_ORGANIZATION', MESSAGE: 'No active organization in session' });
    }
    const id = paramStr(req.params.id);
    const entry = await KpiEntryService.deleteDraft(id, organizationId);
    if (!entry) return Respond(res, { message: 'Entry not found' }, 404);
    return Respond(res, { entry, message: 'Draft entry deleted' }, 200);
  }

  static async importTemplate(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const templateId = String(req.query.templateId || '').trim();
    const departmentId = String(req.query.departmentId || '').trim();
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!templateId || !departmentId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'MISSING_PARAMS',
        MESSAGE: 'templateId and departmentId are required',
      });
    }
    await enforceNodalDepartmentAccess(req, organizationId, departmentId);

    const template = await KpiTemplateModel.findById(templateId).lean();
    if (!template) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'TEMPLATE_NOT_FOUND',
        MESSAGE: 'Template not found',
      });
    }
    if (String((template as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'TEMPLATE_FORBIDDEN',
        MESSAGE: 'Template does not belong to your organization',
      });
    }
    if ((template as any).departmentId && String((template as any).departmentId) !== departmentId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'TEMPLATE_DEPARTMENT_MISMATCH',
        MESSAGE: 'Template is not for this department',
      });
    }

    const employees = await EmployeeModal.find({ department: departmentId } as any)
      .select('_id name email phone departmentRole')
      .lean();

    const items: any[] = Array.isArray((template as any).items) ? (template as any).items : [];
    const itemHeaders = items.map((it) =>
      formatKpiEntryImportValueHeader(it, String(it._id || it.id))
    );
    const remarkHeaders = items.map((it) =>
      formatKpiEntryImportRemarkHeader(it, String(it._id || it.id))
    );

    const header = [
      'employeeId',
      'name',
      'email',
      'phone',
      'divisionOrBlock',
      ...itemHeaders,
      ...remarkHeaders,
    ];

    const rows = employees
      .filter((e) => {
        if (!(template as any).role) return true;
        return (
          String(e.departmentRole || '').toLowerCase() ===
          String((template as any).role).toLowerCase()
        );
      })
      .map((e) => {
        const base: Record<string, unknown> = {
          employeeId: String((e as any)._id),
          name: (e as any).name || '',
          email: (e as any).email || '',
          phone: (e as any).phone || '',
          divisionOrBlock: '',
        };
        itemHeaders.forEach((h) => {
          base[h] = '';
        });
        remarkHeaders.forEach((h) => {
          base[h] = '';
        });
        return base;
      });

    return sendImportLayoutDownload(res, header, rows, format, 'kpi-entries-import-template');
  }

  static async exportEntriesImportFormat(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const templateId = String(req.query.templateId || '').trim();
    const departmentId = String(req.query.departmentId || '').trim();
    const periodId = req.query.periodId ? String(req.query.periodId).trim() : undefined;
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!templateId || !departmentId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'MISSING_PARAMS',
        MESSAGE: 'templateId and departmentId are required',
      });
    }
    await enforceNodalDepartmentAccess(req, organizationId, departmentId);

    const { header, rows } = await KpiEntryService.getImportFormatExportData({
      organizationId,
      templateId,
      departmentId,
      periodId,
    });

    return sendImportLayoutDownload(res, header, rows, format, 'kpi-entries-export');
  }

  static async importEntries(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    const templateId = String(req.query.templateId || '').trim();
    const departmentId = String(req.query.departmentId || '').trim();
    const periodId = req.query.periodId ? String(req.query.periodId) : undefined;
    if (!templateId || !departmentId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'MISSING_PARAMS',
        MESSAGE: 'templateId and departmentId are required',
      });
    }
    await enforceNodalDepartmentAccess(req, organizationId, departmentId);
    if (!req.file?.path) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_FILE',
        MESSAGE: 'Please upload a CSV or XLSX file',
      });
    }

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const fileBuffer = await fs.readFile(req.file.path);

      let rawRows: Record<string, unknown>[] = [];
      if (ext === '.csv') {
        rawRows = parse(fileBuffer, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
        }) as Record<string, unknown>[];
      } else if (ext === '.xlsx') {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'EMPTY_FILE',
            MESSAGE: 'Excel file is empty',
          });
        }
        rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
          defval: '',
        }) as Record<string, unknown>[];
      } else {
        throw new APIError({
          STATUS: 400,
          TITLE: 'UNSUPPORTED_FILE',
          MESSAGE: 'Unsupported file type. Use .csv or .xlsx',
        });
      }

      const result = await KpiEntryService.bulkUpsertDraftFromRows({
        organizationId,
        templateId,
        departmentId,
        periodId,
        rows: rawRows,
      });

      return Respond(
        res,
        {
          ...result,
          message: 'Entries imported successfully',
        },
        200
      );
    } finally {
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => undefined);
      }
    }
  }
}

