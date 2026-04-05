import { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import Respond from '@/lib/respond';
import {
  InvitationImportRow,
  InvitationService,
  parseInvitationQueryFilterValue,
  type InvitationFilterOperator,
} from './invitations.service';

function firstQuery(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v[0] !== undefined ? String(v[0]) : undefined;
  return String(v);
}

function normalizeRow(
  row: Record<string, unknown>
): InvitationImportRow | null {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [
    key.trim().toLowerCase(),
    typeof value === 'string' ? value.trim() : value,
  ]);
  const normalized = Object.fromEntries(normalizedEntries);

  const email = String(normalized.email || '').trim();
  const role = String(normalized.role || '').trim();
  if (!email || !role) return null;

  return { email, role };
}

export class InvitationHandler {
  static async listInvitations(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      return Respond(
        res,
        { message: 'No active organization in session' },
        400
      );
    }

    const limitStr = firstQuery(req.query.limit);
    const offsetStr = firstQuery(req.query.offset);
    const sortBy = firstQuery(req.query.sortBy);
    const sortDirection = firstQuery(req.query.sortDirection);
    const filterField = firstQuery(req.query.filterField);
    const filterOperator = firstQuery(req.query.filterOperator);
    const filterValueRaw = firstQuery(req.query.filterValue);

    const limitParsed =
      limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
    const offsetParsed =
      offsetStr !== undefined ? parseInt(offsetStr, 10) : undefined;

    const result = await InvitationService.listInvitations(organizationId, {
      limit: Number.isFinite(limitParsed) ? limitParsed : undefined,
      offset: Number.isFinite(offsetParsed) ? offsetParsed : undefined,
      sortBy,
      sortDirection:
        sortDirection === 'asc' || sortDirection === 'desc'
          ? sortDirection
          : undefined,
      filterField,
      filterOperator: filterOperator as InvitationFilterOperator | undefined,
      filterValue: filterField
        ? parseInvitationQueryFilterValue(filterValueRaw)
        : undefined,
    });

    Respond(
      res,
      {
        ...result,
        message: 'Invitations listed',
      },
      200
    );
  }

  static async importAdminInvitations(req: Request, res: Response) {
    try {
    if (!req.file?.path) {
      return Respond(res, { message: 'Please upload a CSV or XLSX file' }, 400);
    }

    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      return Respond(
        res,
        { message: 'No active organization in session' },
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
      .filter((row): row is InvitationImportRow => row !== null);

    if (!rows.length) {
      return Respond(
        res,
        {
          message:
            'No valid rows. Required columns: email, role (admin only)',
        },
        400
      );
    }

    const headers = new Headers(req.headers as HeadersInit);
    const result = await InvitationService.importAdminInvitations(
      rows,
      organizationId,
      req.user,
      headers.get('origin') ?? undefined
    );

    Respond(
      res,
      {
        ...result,
        totalProcessed: rows.length,
        message:
          result.emailFailures.length && !result.created && !result.resent
            ? 'No invitation emails could be sent; see emailFailures'
            : 'Invitation import processed',
      },
      200
    );
    } finally {
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => undefined);
      }
    }
  }

  static async importTemplate(req: Request, res: Response) {
    const format = String(req.query.format || 'csv').toLowerCase();
    const templateRows = [{ email: 'admin@example.com', role: 'admin' }];

    if (format === 'xlsx') {
      const sheet = XLSX.utils.json_to_sheet(templateRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Invitations');
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
        'attachment; filename="admin-invitations-import-template.xlsx"'
      );
      return res.send(buffer);
    }

    const csvHeader = 'email,role';
    const csvBody = templateRows
      .map((r) => `${r.email},${r.role}`)
      .join('\n');
    const csv = `${csvHeader}\n${csvBody}\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="admin-invitations-import-template.csv"'
    );
    return res.send(csv);
  }
}
