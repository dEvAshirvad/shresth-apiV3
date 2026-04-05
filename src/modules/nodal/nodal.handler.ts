import { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { isValidObjectId } from 'mongoose';
import { NodalService } from './nodal.services';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import APIError from '@/configs/errors/APIError';
import env from '@/configs/env';
import { HttpErrorStatusCode } from '@/types/errors/errors.types';
import {
  enqueueNodalSendInvitations,
  enqueueNodalSyncMembers,
  KPI_QUEUED_JOB_HINT,
} from '@/jobs/kpiBackground.queue';

interface ImportedNodalRow {
  name: string;
  phone: string;
  email?: string;
  department?: string;
  departmentRole?: string;
}

function normalizeRow(row: Record<string, unknown>): ImportedNodalRow | null {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [
    key.trim().toLowerCase(),
    typeof value === 'string' ? value.trim() : value,
  ]);
  const normalized = Object.fromEntries(normalizedEntries);

  const name = String(normalized.name || '').trim();
  const phone = String(normalized.phone || '').trim();
  if (!name || !phone) return null;

  const email = String(normalized.email || '').trim();
  const department = String(normalized.department || '').trim();
  const departmentRole = String(normalized.departmentrole || '').trim();

  return {
    name,
    phone,
    email: email || undefined,
    department: department || undefined,
    departmentRole: departmentRole || undefined,
  };
}

export class NodalHandler {
  static async createNodal(req: Request, res: Response) {
    try {
      const { name, email, phone } = req.body;
      const organizationId = req.session?.activeOrganizationId;

      if (!organizationId || !isValidObjectId(organizationId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'NO_ACTIVE_ORGANIZATION',
          MESSAGE:
            'No active organization in session. Select an organization first.',
        });
      }

      const nodal = await NodalService.createNodal({
        name,
        email,
        phone,
        organizationId,
      });

      Respond(
        res,
        {
          nodal,
          message: 'Nodal record created successfully',
        },
        201
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async getNodal(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);

      const nodal = await NodalService.getNodal(id);
      if (!nodal) {
        return Respond(
          res,
          {
            message: 'Nodal record not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          nodal,
          message: 'Nodal record fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async getNodals(req: Request, res: Response) {
    try {
      const { page, limit, search } = req.query;
      const organizationId = req.session?.activeOrganizationId;

      if (!organizationId || !isValidObjectId(organizationId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'NO_ACTIVE_ORGANIZATION',
          MESSAGE:
            'No active organization in session. Select an organization first.',
        });
      }

      const filters = {
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 10,
        search: (search as string) || '',
        organizationId,
      };

      const result = await NodalService.getNodals(filters);
      Respond(
        res,
        {
          ...result,
          message: 'Nodal records fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async updateNodal(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);
      const { name, email, phone } = req.body;

      const nodal = await NodalService.updateNodal(id, {
        name,
        email,
        phone,
      });

      if (!nodal) {
        return Respond(
          res,
          {
            message: 'Nodal record not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          nodal,
          message: 'Nodal record updated successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async deleteNodal(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);

      const nodal = await NodalService.deleteNodal(id);
      if (!nodal) {
        return Respond(
          res,
          {
            message: 'Nodal record not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          nodal,
          message: 'Nodal record deleted successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async importNodals(req: Request, res: Response) {
    try {
      if (!req.file?.path) {
        return Respond(
          res,
          { message: 'Please upload a CSV or XLSX file' },
          400
        );
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const fileBuffer = await fs.readFile(req.file.path);

      let rawRows: Record<string, unknown>[] = [];
      if (ext === '.csv') {
        const csvRows = parse(fileBuffer, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
        });
        rawRows = csvRows as Record<string, unknown>[];
      } else if (ext === '.xlsx') {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) {
          return Respond(res, { message: 'Excel file is empty' }, 400);
        }
        rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
          defval: '',
        }) as Record<string, unknown>[];
      } else {
        return Respond(
          res,
          { message: 'Unsupported file type. Use .csv or .xlsx' },
          400
        );
      }

      const rows = rawRows
        .map((row) => normalizeRow(row))
        .filter((row): row is ImportedNodalRow => row !== null);

      if (!rows.length) {
        return Respond(
          res,
          {
            message:
              'No valid rows found. Required columns: name, phone (email optional)',
          },
          400
        );
      }

      const organizationId = req.session?.activeOrganizationId;
      if (!organizationId || !isValidObjectId(organizationId)) {
        return Respond(
          res,
          { message: 'No active organization in session' },
          400
        );
      }

      const result = await NodalService.importNodals(rows, organizationId);

      Respond(
        res,
        {
          ...result,
          totalProcessed: rows.length,
          message: 'Nodal records imported successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    } finally {
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => undefined);
      }
    }
  }

  static async importTemplate(req: Request, res: Response) {
    try {
      const format = String(req.query.format || 'csv').toLowerCase();
      const templateRows = [
        {
          name: 'Jane Nodal',
          phone: '9888888888',
          email: 'jane@example.com',
        },
      ];

      if (format === 'xlsx') {
        const sheet = XLSX.utils.json_to_sheet(templateRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, 'Nodals');
        const buffer = XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx',
        });

        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="nodals-import-template.xlsx"'
        );
        return res.send(buffer);
      }

      const csvHeader = 'name,phone,email';
      const csvExample = 'Jane Nodal,9888888888,jane@example.com';
      const csv = `${csvHeader}\n${csvExample}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="nodals-import-template.csv"'
      );
      return res.send(csv);
    } catch (error: any) {
      throw error;
    }
  }

  static async attachUserIdAndMemberId(req: Request, res: Response) {
    try {
      const { userId, memberId } = req.body;
      const email = paramStr(req.params.email);

      const nodal = await NodalService.attachUserIdAndMemberId(email, {
        userId,
        memberId,
      });

      Respond(
        res,
        {
          nodal,
          message: 'userId and memberId attached',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async syncFromOrgMembers(req: Request, res: Response) {
    try {
      const organizationId = req.session?.activeOrganizationId;

      if (!organizationId || !isValidObjectId(organizationId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'NO_ACTIVE_ORGANIZATION',
          MESSAGE:
            'No active organization in session. Select an organization first.',
        });
      }

      const user = req.user as { id?: string } | undefined;

      if (env.BACKGROUND_JOBS_SYNC) {
        const result =
          await NodalService.syncUserAndMemberFromEmails(organizationId);

        Respond(
          res,
          {
            mode: 'sync',
            ...result,
            message:
              result.linked > 0
                ? `Linked ${result.linked} nodal record(s) to user and member records`
                : 'No nodal records linked; see skipped',
          },
          200
        );
        return;
      }

      try {
        const { jobId } = await enqueueNodalSyncMembers({
          organizationId,
          triggeredByUserId: user?.id,
        });
        Respond(
          res,
          {
            mode: 'queued',
            jobId,
            message:
              'Nodal sync-from-org-members queued. Poll GET /api/v1/jobs/:jobId for status.',
            hint: KPI_QUEUED_JOB_HINT,
          },
          202
        );
      } catch (err) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.SERVICE_UNAVAILABLE,
          TITLE: 'JOB_QUEUE_UNAVAILABLE',
          MESSAGE:
            'Could not enqueue job. Ensure Redis is running and the worker is started, or set BACKGROUND_JOBS_SYNC=true.',
          META: { cause: err instanceof Error ? err.message : String(err) },
        });
      }
    } catch (error: any) {
      throw error;
    }
  }

  static async sendInvitationToRestNodals(req: Request, res: Response) {
    try {
      const organizationId = req.session?.activeOrganizationId;
      const user = req.user;

      if (!organizationId || !isValidObjectId(organizationId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'NO_ACTIVE_ORGANIZATION',
          MESSAGE:
            'No active organization in session. Select an organization in the app first, or ensure your session includes activeOrganizationId.',
        });
      }
      const headers = new Headers(req.headers as HeadersInit);
      const origin = headers.get('origin') ?? undefined;

      if (!user?.id) {
        throw new APIError({
          STATUS: 401,
          TITLE: 'UNAUTHORIZED',
          MESSAGE: 'Authentication required',
        });
      }

      if (env.BACKGROUND_JOBS_SYNC) {
        const { nodalToInvite, errors } =
          await NodalService.sendInvitationToRestNodals(
            organizationId,
            user,
            origin
          );
        Respond(
          res,
          {
            mode: 'sync',
            nodals: nodalToInvite,
            errors,
            message:
              errors.length && !nodalToInvite.length
                ? 'No invitations could be sent'
                : errors.length
                  ? 'Some invitations could not be sent; see errors'
                  : 'Invitations sent successfully',
          },
          200
        );
        return;
      }

      try {
        const { jobId } = await enqueueNodalSendInvitations({
          organizationId,
          triggeredByUserId: user.id,
          origin,
        });
        Respond(
          res,
          {
            mode: 'queued',
            jobId,
            message:
              'Nodal invitation batch queued. Poll GET /api/v1/jobs/:jobId — returnvalue contains nodals and errors when completed.',
            hint: KPI_QUEUED_JOB_HINT,
          },
          202
        );
      } catch (err) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.SERVICE_UNAVAILABLE,
          TITLE: 'JOB_QUEUE_UNAVAILABLE',
          MESSAGE:
            'Could not enqueue job. Ensure Redis is running and the worker is started, or set BACKGROUND_JOBS_SYNC=true.',
          META: { cause: err instanceof Error ? err.message : String(err) },
        });
      }
    } catch (error: any) {
      throw error;
    }
  }

  static async amIAssigned(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const nodal = await NodalService.amIAssigned(userId);

      Respond(
        res,
        {
          ...nodal,
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }
}
