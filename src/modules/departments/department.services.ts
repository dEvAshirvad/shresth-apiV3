import mongoose, { QueryFilter } from 'mongoose';
import {
  DepartmentModel,
  DepartmentUpdate,
  DepartmentCreate,
  Department,
} from './departments.model';
import { EmployeeModal } from '../employee/employee.model';
import { KpiEntryModel } from '../entries/entries.model';
import { UserModel } from '../auth/users/users.model';
import { MemberModel } from '../auth/members/members.model';

interface DepartmentImportRow {
  name: string;
  slug?: string;
  /** Resolved from import column; set `assignedNodal` when member exists in org */
  nodalEmail?: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type NodalImportError = {
  slug: string;
  email: string;
  reason: string;
};

export class DepartmentService {
  static async createDepartment(department: DepartmentCreate, orgId: string) {
    const newDepartment = await DepartmentModel.create({
      ...department,
      organizationId: orgId,
    });
    return newDepartment;
  }

  static async getDepartment(id: string, orgId: string) {
    const department = await DepartmentModel.findOne({
      _id: id,
      organizationId: orgId,
    } as any)
      .populate({
        path: 'assignedNodal',
        populate: {
          path: 'userId',
        },
      })
      .populate({
        path: 'organizationId',
        populate: {
          path: 'name',
        },
      })
      .lean();
    return department;
  }

  static async getDepartments(
    {
      page = 1,
      limit = 10,
      search = '',
      assignedNodal = '',
    }: {
      page?: number;
      limit?: number;
      search?: string;
      assignedNodal?: string;
    },
    orgId: string
  ) {
    const query: QueryFilter<Department> = {
      organizationId: orgId,
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ],
    };
    if (assignedNodal) {
      query.assignedNodal = assignedNodal;
    }
    const [departments, total] = await Promise.all([
      DepartmentModel.find(query)
        .populate({
          path: 'assignedNodal',
          populate: {
            path: 'userId',
          },
        })
        .populate({
          path: 'organizationId',
          populate: {
            path: 'name',
          },
        })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DepartmentModel.countDocuments({
        organizationId: orgId,
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } },
        ],
      } as any),
    ]);

    return {
      docs: departments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };
  }

  static async updateDepartment(
    id: string,
    department: DepartmentUpdate,
    organizationId: string
  ) {
    const updatedDepartment = await DepartmentModel.findOneAndUpdate(
      { _id: id, organizationId } as any,
      { $set: department },
      { new: true }
    ).lean();
    return updatedDepartment;
  }

  static async assignNodal(id: string, nodal: string, organizationId: string) {
    const updatedDepartment = await DepartmentModel.findOneAndUpdate(
      { _id: id, organizationId } as any,
      { $set: { assignedNodal: new mongoose.Types.ObjectId(nodal) } },
      { new: true }
    ).lean();
    return updatedDepartment;
  }

  static async deleteDepartment(id: string, organizationId: string) {
    const deletedDepartment = await DepartmentModel.findOneAndDelete({
      _id: id,
      organizationId,
    } as any);
    return deletedDepartment;
  }

  /**
   * Find org **member** `_id` for a user login email (member must belong to `organizationId`).
   */
  static async findMemberIdByEmailForOrg(
    organizationId: string,
    email: string
  ): Promise<string | null> {
    const trimmed = email.trim();
    if (!trimmed) return null;

    const user = await UserModel.findOne({
      email: new RegExp(`^${escapeRegex(trimmed)}$`, 'i'),
    } as any)
      .select('_id')
      .lean();
    if (!user) return null;

    const member = await MemberModel.findOne({
      organizationId,
      userId: (user as any)._id,
    } as any)
      .select('_id')
      .lean();
    return member ? String((member as any)._id) : null;
  }

  static async importDepartments(
    rows: DepartmentImportRow[],
    organizationId: string
  ) {
    if (!rows.length) {
      return {
        insertedCount: 0,
        updatedCount: 0,
        nodalAssignmentErrors: [] as NodalImportError[],
      };
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const nodalAssignmentErrors: NodalImportError[] = [];

    for (const row of rows) {
      const updateDoc = {
        name: row.name,
        slug: row.slug || '',
        organizationId,
      };

      const $set: Record<string, unknown> = { ...updateDoc };

      if (row.nodalEmail?.trim()) {
        const memberId = await this.findMemberIdByEmailForOrg(
          organizationId,
          row.nodalEmail
        );
        if (memberId) {
          $set.assignedNodal = new mongoose.Types.ObjectId(memberId);
        } else {
          nodalAssignmentErrors.push({
            slug: updateDoc.slug,
            email: row.nodalEmail.trim(),
            reason:
              'No user with that email, or user is not a member of this organization',
          });
        }
      }

      const existing = await DepartmentModel.findOneAndUpdate(
        { slug: updateDoc.slug, organizationId } as any,
        { $set: $set },
        { upsert: true, new: false }
      ).lean();

      if (existing) updatedCount += 1;
      else insertedCount += 1;
    }

    return { insertedCount, updatedCount, nodalAssignmentErrors };
  }

  static async OrganizationDepartmentStatistics(organizationId: string) {
    const stats = await DepartmentModel.aggregate([
      { $match: { organizationId } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ]);
    return stats;
  }

  static async DepartmentNodalStatistics(departmentId: string) {
    const deptObjectId = new mongoose.Types.ObjectId(departmentId);

    const [department, employeeRoles, entryRoles] = await Promise.all([
      DepartmentModel.findById(deptObjectId)
        .populate({
          path: 'assignedNodal',
          populate: { path: 'userId' },
        })
        .lean(),
      EmployeeModal.aggregate([
        { $match: { department: deptObjectId } },
        {
          $group: {
            _id: { $ifNull: ['$departmentRole', 'UNASSIGNED'] },
            employees: { $sum: 1 },
          },
        },
        { $sort: { employees: -1 } },
      ]),
      KpiEntryModel.aggregate([
        { $match: { departmentId: deptObjectId } },
        {
          $group: {
            _id: { $ifNull: ['$roleSnapshot', 'UNASSIGNED'] },
            entries: { $sum: 1 },
          },
        },
        { $sort: { entries: -1 } },
      ]),
    ]);

    return {
      departmentId,
      assignedNodal: (department as any)?.assignedNodal ?? null,
      roles: employeeRoles.map((r: any) => ({
        role: String(r._id),
        employees: r.employees,
      })),
      entriesByRole: entryRoles.map((r: any) => ({
        role: String(r._id),
        entries: r.entries,
      })),
    };
  }
}
