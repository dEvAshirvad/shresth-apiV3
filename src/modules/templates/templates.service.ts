import APIError from '@/configs/errors/APIError';
import { EmployeeModal } from '../employee/employee.model';
import { DepartmentModel } from '../departments/departments.model';
import {
  KpiTemplateCreate,
  KpiTemplate,
  KpiTemplateModel,
  KpiTemplateUpdate,
} from './templates.model';
import { QueryFilter } from 'mongoose';

export class KpiTemplateService {
  static async createTemplate(
    template: KpiTemplateCreate,
    organizationId: string
  ) {
    await this.validateRoleInDepartment(
      template.departmentId || '',
      template.role || ''
    );

    const created = await KpiTemplateModel.create({
      ...template,
      organizationId,
    });
    return created;
  }

  static async getTemplate(id: string, organizationId: string) {
    const template = await KpiTemplateModel.findOne({
      _id: id,
      organizationId,
    } as any).lean();
    return template;
  }

  static async getTemplates(
    {
      page = 1,
      limit = 10,
      search = '',
      departmentId,
      departmentIdFilter,
      role,
    }: {
      page?: number;
      limit?: number;
      search?: string;
      departmentId?: string;
      departmentIdFilter?: QueryFilter<KpiTemplate>;
      role?: string;
    },
    organizationId: string
  ) {
    const filter: any = { organizationId };
    if (departmentIdFilter) {
      Object.assign(filter, departmentIdFilter);
    } else if (departmentId) {
      filter.departmentId = departmentId;
    }
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      KpiTemplateModel.find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      KpiTemplateModel.countDocuments(filter),
    ]);

    return {
      docs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };
  }

  static async updateTemplate(
    id: string,
    patch: KpiTemplateUpdate,
    organizationId: string
  ) {
    const existing = await KpiTemplateModel.findOne({
      _id: id,
      organizationId,
    } as any).lean();
    if (!existing) return null;

    const nextDepartmentId =
      patch.departmentId ?? String(existing.departmentId || '');
    const nextRole = patch.role ?? existing.role;

    if (nextDepartmentId && nextRole) {
      await this.validateRoleInDepartment(nextDepartmentId, nextRole);
    }

    const updated = await KpiTemplateModel.findOneAndUpdate(
      { _id: id, organizationId } as any,
      { $set: patch },
      { new: true }
    ).lean();
    return updated;
  }

  static async deleteTemplate(id: string, organizationId: string) {
    const deleted = await KpiTemplateModel.findOneAndDelete({
      _id: id,
      organizationId,
    } as any).lean();
    return deleted;
  }

  /**
   * Extra validation required by product:
   * role used in template must exist among employees in the same department.
   */
  private static async validateRoleInDepartment(
    departmentId: string,
    role: string
  ) {
    const department = await DepartmentModel.findById(departmentId).lean();
    if (!department) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_DEPARTMENT',
        MESSAGE: 'Department not found',
      });
    }

    const roleExists = await EmployeeModal.exists({
      department: departmentId,
      departmentRole: { $regex: `^${this.escapeRegex(role)}$`, $options: 'i' },
    } as any);

    if (!roleExists) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ROLE_FOR_DEPARTMENT',
        MESSAGE:
          'Role is not present in this department employees. Add at least one employee with this departmentRole first.',
      });
    }
  }

  private static escapeRegex(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
