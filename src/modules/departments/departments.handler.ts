import { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { DepartmentService } from './department.services';
import Respond from '@/lib/respond';
import logger from '@/configs/logger/winston';
import { paramStr } from '@/lib/param';
import { zDepartmentGet } from './departments.model';

interface ImportedDepartmentRow {
  name: string;
  slug: string;
  /** From `nodal_email` / `assigned_nodal_email` / `nodal email` */
  nodalEmail?: string;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeRow(
  row: Record<string, unknown>
): ImportedDepartmentRow | null {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [
    key.trim().toLowerCase(),
    typeof value === 'string' ? value.trim() : value,
  ]);
  const normalized = Object.fromEntries(normalizedEntries);

  const name = String(normalized.name || '').trim();
  if (!name) return null;

  const rawSlug = String(normalized.slug || '').trim();
  const slug = rawSlug || slugify(name);
  if (!slug) return null;

  const nodalEmail = String(
    normalized.nodal_email ||
      normalized['assigned_nodal_email'] ||
      normalized['assignednodalemail'] ||
      normalized['nodal email'] ||
      ''
  ).trim();

  return {
    name,
    slug,
    ...(nodalEmail ? { nodalEmail } : {}),
  };
}

export class DepartmentHandler {
  static async createDepartment(req: Request, res: Response) {
    try {
      const { name, slug, logo, metadata } = req.body;

      const department = await DepartmentService.createDepartment(
        {
          name,
          slug,
          logo,
          metadata,
        },
        req.session?.activeOrganizationId || ''
      );

      Respond(
        res,
        {
          department,
          message: 'Department created successfully',
        },
        201
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async getDepartment(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);

      const department = await DepartmentService.getDepartment(
        id,
        req.session?.activeOrganizationId || ''
      );
      if (!department) {
        return Respond(
          res,
          {
            message: 'Department not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          department,
          message: 'Department fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async getDepartments(req: Request, res: Response) {
    try {
      const { page, limit, search, assignedNodal } = zDepartmentGet.parse(
        req.query
      );

      const filters = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        search: search || '',
        assignedNodal: assignedNodal || undefined,
      };

      const result = await DepartmentService.getDepartments(
        filters,
        req.session?.activeOrganizationId || ''
      );
      Respond(
        res,
        {
          ...result,
          message: 'Departments fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async updateDepartment(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);
      const { name, slug, logo, metadata } = req.body;

      const department = await DepartmentService.updateDepartment(
        id,
        {
          name,
          slug,
          logo,
          metadata,
        },
        req.session?.activeOrganizationId || ''
      );

      if (!department) {
        return Respond(
          res,
          {
            message: 'Department not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          department,
          message: 'Department updated successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async assignNodal(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);
      const { assignedNodal } = req.body;

      const department = await DepartmentService.assignNodal(
        id,
        assignedNodal,
        req.session?.activeOrganizationId || ''
      );

      return Respond(
        res,
        { department, message: 'Nodal assigned successfully' },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async deleteDepartment(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);

      const department = await DepartmentService.deleteDepartment(
        id,
        req.session?.activeOrganizationId || ''
      );
      if (!department) {
        return Respond(
          res,
          {
            message: 'Department not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          department,
          message: 'Department deleted successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async importDepartments(req: Request, res: Response) {
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
        .filter((row): row is ImportedDepartmentRow => row !== null);

      if (!rows.length) {
        return Respond(
          res,
          {
            message:
              'No valid rows found. Required columns: name, slug (optional), nodal_email (optional — org member email)',
          },
          400
        );
      }

      const result = await DepartmentService.importDepartments(
        rows,
        req.session?.activeOrganizationId || ''
      );

      Respond(
        res,
        {
          ...result,
          totalProcessed: rows.length,
          message: 'Departments imported successfully',
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
          name: 'Computer Science',
          slug: 'computer-science',
          nodal_email: 'nodal.user@example.com',
        },
      ];

      if (format === 'xlsx') {
        const sheet = XLSX.utils.json_to_sheet(templateRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, 'Departments');
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
          'attachment; filename="departments-import-template.xlsx"'
        );
        return res.send(buffer);
      }

      const csvHeader = 'name,slug,nodal_email';
      const csvExample =
        'Computer Science,computer-science,nodal.user@example.com';
      const csv = `${csvHeader}\n${csvExample}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="departments-import-template.csv"'
      );
      return res.send(csv);
    } catch (error: any) {
      throw error;
    }
  }

  static async getOrganizationDepartmentStatistics(
    req: Request,
    res: Response
  ) {
    try {
      const stats = await DepartmentService.OrganizationDepartmentStatistics(
        req.session?.activeOrganizationId || ''
      );
      Respond(
        res,
        {
          stats,
          message: 'Organization department statistics fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }
}
