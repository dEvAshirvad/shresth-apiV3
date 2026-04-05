import { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { isValidObjectId } from 'mongoose';
import { EmployeeService } from './employee.services';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import APIError from '@/configs/errors/APIError';

interface ImportedEmployeeRow {
  name: string;
  phone: string;
  email?: string;
  department?: string;
  departmentRole?: string;
}

function normalizeRow(
  row: Record<string, unknown>
): ImportedEmployeeRow | null {
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

export class EmployeeHandler {
  static async createEmployee(req: Request, res: Response) {
    try {
      const { name, email, phone, department, departmentRole } = req.body;

      const employee = await EmployeeService.createEmployee({
        name,
        email,
        phone,
        department,
        departmentRole,
      });

      Respond(
        res,
        {
          employee,
          message: 'Employee created successfully',
        },
        201
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async getEmployee(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);

      const employee = await EmployeeService.getEmployee(id);
      if (!employee) {
        return Respond(
          res,
          {
            message: 'Employee not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          employee,
          message: 'Employee fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async getEmployees(req: Request, res: Response) {
    try {
      const { page, limit, search } = req.query;

      const filters = {
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 10,
        search: (search as string) || '',
      };

      const result = await EmployeeService.getEmployees(filters);
      Respond(
        res,
        {
          ...result,
          message: 'Employees fetched successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async updateEmployee(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);
      const { name, email, phone, department, departmentRole } = req.body;

      const employee = await EmployeeService.updateEmployee(id, {
        name,
        email,
        phone,
        department,
        departmentRole,
      });

      if (!employee) {
        return Respond(
          res,
          {
            message: 'Employee not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          employee,
          message: 'Employee updated successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async deleteEmployee(req: Request, res: Response) {
    try {
      const id = paramStr(req.params.id);

      const employee = await EmployeeService.deleteEmployee(id);
      if (!employee) {
        return Respond(
          res,
          {
            message: 'Employee not found',
          },
          404
        );
      }

      Respond(
        res,
        {
          employee,
          message: 'Employee deleted successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async importEmployees(req: Request, res: Response) {
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
        .filter((row): row is ImportedEmployeeRow => row !== null);

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

      const result = await EmployeeService.importEmployees(
        rows,
        req.body.departmentId
      );

      Respond(
        res,
        {
          ...result,
          totalProcessed: rows.length,
          message: 'Employees imported successfully',
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
          name: 'John Doe',
          phone: '9999999999',
          email: 'john@example.com',
          departmentRole: 'Professor',
        },
      ];

      if (format === 'xlsx') {
        const sheet = XLSX.utils.json_to_sheet(templateRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, 'Employees');
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
          'attachment; filename="employees-import-template.xlsx"'
        );
        return res.send(buffer);
      }

      const csvHeader = 'name,phone,email,departmentRole';
      const csvExample = 'John Doe,9999999999,john@example.com,Professor';
      const csv = `${csvHeader}\n${csvExample}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="employees-import-template.csv"'
      );
      return res.send(csv);
    } catch (error: any) {
      throw error;
    }
  }

  static async attachUserIdAndMemberId(req: Request, res: Response) {
    try {
      const email = paramStr(req.params.email);
      const { userId, memberId } = req.body;
      const organizationId = req.session?.activeOrganizationId;

      if (!organizationId || !isValidObjectId(organizationId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'NO_ACTIVE_ORGANIZATION',
          MESSAGE:
            'No active organization in session. Select an organization first.',
        });
      }

      const employee = await EmployeeService.attachUserIdAndMemberId(email, {
        userId,
        memberId,
      });

      Respond(
        res,
        {
          employee,
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
      const { departmentId } = req.body;
      const organizationId = req.session?.activeOrganizationId;

      if (!organizationId || !isValidObjectId(organizationId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'NO_ACTIVE_ORGANIZATION',
          MESSAGE:
            'No active organization in session. Select an organization first.',
        });
      }
      if (!departmentId || !isValidObjectId(departmentId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'INVALID_DEPARTMENT_ID',
          MESSAGE: 'Invalid department id',
        });
      }

      const result = await EmployeeService.syncUserAndMemberFromEmails(
        organizationId,
        departmentId
      );

      Respond(
        res,
        {
          ...result,
          message:
            result.linked > 0
              ? `Linked ${result.linked} employee(s) to user and member records`
              : 'No employees linked; see skipped',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }

  static async sendInvitationToRestEmployees(req: Request, res: Response) {
    try {
      const { departmentId } = req.body;
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
      if (!departmentId || !isValidObjectId(departmentId)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'INVALID_DEPARTMENT_ID',
          MESSAGE: 'Invalid department id',
        });
      }
      const headers = new Headers(req.headers as HeadersInit);
      const { employeeToInvite, errors } =
        await EmployeeService.sendInvitationToRestEmployees(
          departmentId,
          organizationId,
          user,
          headers.get('origin') ?? undefined
        );
      Respond(
        res,
        {
          employees: employeeToInvite,
          errors,
          message:
            errors.length && !employeeToInvite.length
              ? 'No invitations could be sent'
              : errors.length
                ? 'Some invitations could not be sent; see errors'
                : 'Invitations sent successfully',
        },
        200
      );
    } catch (error: any) {
      throw error;
    }
  }
}
