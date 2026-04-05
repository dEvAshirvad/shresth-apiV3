import { Request, Response } from 'express';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import { KpiTemplateService } from './templates.service';
import { DepartmentService } from '../departments/department.services';
import { QueryFilter } from 'mongoose';
import { KpiTemplate } from './templates.model';

export class KpiTemplateHandler {
  static async createTemplate(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId || '';
    const template = await KpiTemplateService.createTemplate(
      req.body,
      organizationId
    );
    return Respond(
      res,
      { template, message: 'KPI template created successfully' },
      201
    );
  }

  static async getTemplate(req: Request, res: Response) {
    const id = paramStr(req.params.id);
    const organizationId = req.session?.activeOrganizationId || '';

    const template = await KpiTemplateService.getTemplate(id, organizationId);
    if (!template) {
      return Respond(res, { message: 'KPI template not found' }, 404);
    }
    return Respond(
      res,
      { template, message: 'KPI template fetched successfully' },
      200
    );
  }

  static async getTemplates(req: Request, res: Response) {
    const { page, limit, search, departmentId, role } = req.query;
    const organizationId = req.session?.activeOrganizationId || '';
    const isNodal = req.session?.activeOrganizationRole === 'nodal';
    let departmentIdFilter: QueryFilter<KpiTemplate> | undefined = departmentId
      ? { departmentId: departmentId as string }
      : undefined;

    if (isNodal) {
      const memberId = req.session?.memberId || '';
      const departments = await DepartmentService.getDepartments(
        { assignedNodal: memberId, page: 1, limit: 1000, search: '' },
        organizationId
      );
      const allowedDepartmentIds = departments.docs.map((dept: any) =>
        String(dept._id)
      );

      if (departmentId) {
        // Nodal can request only its own assigned departments.
        departmentIdFilter = allowedDepartmentIds.includes(String(departmentId))
          ? { departmentId: String(departmentId) }
          : { departmentId: { $in: [] } };
      } else {
        departmentIdFilter = { departmentId: { $in: allowedDepartmentIds } };
      }
    }

    console.log(departmentIdFilter, '---:---', req.originalUrl);

    const result = await KpiTemplateService.getTemplates(
      {
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 10,
        search: (search as string) || '',
        departmentIdFilter: departmentIdFilter || undefined,
        role: (role as string) || undefined,
      },
      organizationId
    );

    return Respond(
      res,
      { ...result, message: 'KPI templates fetched successfully' },
      200
    );
  }

  static async updateTemplate(req: Request, res: Response) {
    const id = paramStr(req.params.id);
    const organizationId = req.session?.activeOrganizationId || '';

    const template = await KpiTemplateService.updateTemplate(
      id,
      req.body,
      organizationId
    );
    if (!template) {
      return Respond(res, { message: 'KPI template not found' }, 404);
    }
    return Respond(
      res,
      { template, message: 'KPI template updated successfully' },
      200
    );
  }

  static async deleteTemplate(req: Request, res: Response) {
    const id = paramStr(req.params.id);
    const organizationId = req.session?.activeOrganizationId || '';

    const template = await KpiTemplateService.deleteTemplate(
      id,
      organizationId
    );
    if (!template) {
      return Respond(res, { message: 'KPI template not found' }, 404);
    }
    return Respond(
      res,
      { template, message: 'KPI template deleted successfully' },
      200
    );
  }
}
