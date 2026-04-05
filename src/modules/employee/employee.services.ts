import { User } from '@/types/global';
import {
  Invitation,
  InvitationModel,
} from '../auth/invitations/invitations.model';
import {
  EmployeeDepartmentCreate,
  EmployeeDepartmentUpdate,
  EmployeeModal,
  type Employee,
} from './employee.model';
import { DepartmentModel } from '../departments/departments.model';
import { MemberModel } from '../auth/members/members.model';
import mongoose, { isValidObjectId } from 'mongoose';
import APIError from '@/configs/errors/APIError';
import emailTemplates from '@/configs/emailTemplates';
import { UserModel } from '../auth/users/users.model';
import { OrganizationModel } from '../auth/organizations/organizations.model';
import logger from '@/configs/logger/winston';
import { z } from 'zod';

export interface InvitationEmployeeError {
  employeeId: string;
  email?: string;
  message: string;
}

export interface SyncUserMemberSkip {
  employeeId: string;
  email?: string;
  reason: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface EmployeeImportRow {
  name: string;
  phone: string;
  email?: string;
  departmentRole?: string;
}

export class EmployeeService {
  static async createEmployee(payload: EmployeeDepartmentCreate) {
    if (!isValidObjectId(payload.department)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_DEPARTMENT_ID',
        MESSAGE: 'Invalid department ID',
      });
    }
    const employee = await EmployeeModal.create(payload);
    return employee;
  }

  static async getEmployee(id: string) {
    const employee = await EmployeeModal.findById(id)
      .populate('department')
      .populate('invitationId')
      .populate('userId')
      .lean();
    return employee;
  }

  static async getEmployees({
    page = 1,
    limit = 10,
    search = '',
  }: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [employees, total] = await Promise.all([
      EmployeeModal.find(filter)
        .populate('department')
        .populate('invitationId')
        .populate('userId')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      EmployeeModal.countDocuments(filter),
    ]);

    return {
      docs: employees,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };
  }

  static async updateEmployee(id: string, update: EmployeeDepartmentUpdate) {
    const employee = await EmployeeModal.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).lean();
    return employee;
  }

  static async deleteEmployee(id: string) {
    const employee = await EmployeeModal.findByIdAndDelete(id).lean();
    return employee;
  }

  static async importEmployees(
    rows: EmployeeImportRow[],
    departmentId: string
  ) {
    if (!rows.length) {
      return { insertedCount: 0, updatedCount: 0 };
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (const row of rows) {
      const updateDoc: any = {
        name: row.name,
        email: row.email,
        phone: row.phone,
        department: departmentId,
        departmentRole: row.departmentRole,
      };

      const existing = await EmployeeModal.findOneAndUpdate(
        { phone: row.phone } as any,
        { $set: updateDoc },
        { upsert: true, new: false }
      ).lean();

      if (existing) updatedCount += 1;
      else insertedCount += 1;
    }

    return { insertedCount, updatedCount };
  }

  /**
   * For each employee in the department with an **email**, looks up **`user`** by email and **`member`**
   * by `(organizationId, userId)`. When both exist, sets **`userId`** and **`memberId`** on the employee row.
   * Skips rows that already have both ids, or when email maps to a different user than an existing **`userId`**.
   */
  static async syncUserAndMemberFromEmails(
    organizationId: string,
    departmentId: string
  ): Promise<{ linked: number; skipped: SyncUserMemberSkip[] }> {
    if (!isValidObjectId(organizationId) || !isValidObjectId(departmentId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_IDS',
        MESSAGE: 'Invalid organization or department id',
      });
    }

    const dept = await DepartmentModel.findOne({
      _id: departmentId,
      organizationId,
    } as any).lean();
    if (!dept) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'DEPARTMENT_NOT_FOUND',
        MESSAGE: 'Department not found for this organization',
      });
    }

    const orgOid = new mongoose.Types.ObjectId(organizationId);
    const deptOid = new mongoose.Types.ObjectId(departmentId);

    const employees = await EmployeeModal.find({ department: deptOid } as any)
      .select('_id email userId memberId')
      .lean();

    const skipped: SyncUserMemberSkip[] = [];
    let linked = 0;

    for (const emp of employees) {
      const id = String((emp as any)._id);
      const email = (emp as any).email?.trim();
      const existingUid = (emp as any).userId;
      const existingMid = (emp as any).memberId;

      if (existingUid && existingMid) {
        skipped.push({
          employeeId: id,
          email: email || undefined,
          reason: 'Already has userId and memberId',
        });
        continue;
      }
      if (!email) {
        skipped.push({
          employeeId: id,
          reason: 'No email on record',
        });
        continue;
      }

      const user = await UserModel.findOne({
        email: new RegExp(`^${escapeRegex(email)}$`, 'i'),
      } as any)
        .select('_id')
        .lean();

      if (!user) {
        skipped.push({
          employeeId: id,
          email,
          reason: 'No user with this email',
        });
        continue;
      }

      const userId = (user as any)._id;
      if (existingUid && String(existingUid) !== String(userId)) {
        skipped.push({
          employeeId: id,
          email,
          reason: 'userId on record does not match user for this email',
        });
        continue;
      }

      const member = await MemberModel.findOne({
        organizationId: orgOid,
        userId,
      } as any)
        .select('_id')
        .lean();

      if (!member) {
        skipped.push({
          employeeId: id,
          email,
          reason: 'User is not a member of this organization',
        });
        continue;
      }

      await EmployeeModal.updateOne({ _id: (emp as any)._id } as any, {
        $set: {
          userId,
          memberId: (member as any)._id,
        },
      });
      linked += 1;
    }

    return { linked, skipped };
  }

  /**
   * Sets **`userId`** and **`memberId`** on one employee when the caller supplies ids.
   * Verifies the employee’s department belongs to **`organizationId`** and that **`member`**
   * matches **`(organizationId, userId)`** and **`member._id === memberId`**.
   */
  static async attachUserIdAndMemberId(
    email: string,
    payload: { userId?: string; memberId: string }
  ) {
    if (
      !isValidObjectId(payload.userId) ||
      !isValidObjectId(payload.memberId)
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_IDS',
        MESSAGE: 'organizationId, userId, and memberId must be valid ObjectIds',
      });
    }

    const userOid = new mongoose.Types.ObjectId(payload.userId);
    const memberOid = new mongoose.Types.ObjectId(payload.memberId);

    const nodal = await EmployeeModal.findOne({ email }).select('email').lean();
    if (!nodal) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'NODAL_NOT_FOUND',
        MESSAGE: 'Nodal record not found',
      });
    }

    const member = await MemberModel.findById(memberOid)
      .select('userId')
      .lean();

    const user = await UserModel.findById(userOid ? userOid : member?.userId)
      .select('email')
      .lean();

    const updated = await EmployeeModal.findOneAndUpdate(
      { email },
      {
        $set: {
          userId: user?.email === email ? userOid : null,
          memberId: member?.userId === String(userOid) ? memberOid : null,
        },
      },
      { upsert: true, new: true }
    );
    return updated;
  }

  static async sendInvitationToRestEmployees(
    departmentId: string,
    organizationId: string,
    user?: User,
    origin?: string
  ) {
    if (!isValidObjectId(departmentId) || !isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_IDS',
        MESSAGE: 'Invalid department or organization id',
      });
    }
    if (!user?.id) {
      throw new APIError({
        STATUS: 401,
        TITLE: 'INVITER_REQUIRED',
        MESSAGE: 'Authenticated inviter is required to send invitations',
      });
    }

    type PopulatedInvitation = mongoose.FlattenMaps<Invitation> & {
      _id: mongoose.Types.ObjectId;
    };

    type EmployeeDoc = mongoose.FlattenMaps<Employee> & {
      _id: mongoose.Types.ObjectId;
      invitationId?: mongoose.Types.ObjectId | PopulatedInvitation | null;
      userId?: unknown;
    };

    const employees = await EmployeeModal.find({
      department: new mongoose.Types.ObjectId(departmentId),
    } as any)
      .select('name email phone department departmentRole invitationId userId')
      .populate('invitationId')
      .limit(500)
      .lean<EmployeeDoc[]>();

    const errors: InvitationEmployeeError[] = [];
    /** No invitation yet, or invitation expired/revoked → create a new row */
    const eligibleNew: EmployeeDoc[] = [];
    /** invitation.status === pending → resend email only */
    const eligibleResend: {
      employee: EmployeeDoc;
      invitation: PopulatedInvitation;
    }[] = [];

    for (const employee of employees) {
      if (employee.userId) continue;

      const email = employee.email?.trim();
      if (!email) {
        errors.push({
          employeeId: employee._id.toString(),
          message: 'Employee has no email address',
        });
        continue;
      }
      if (!z.string().email().safeParse(email).success) {
        errors.push({
          employeeId: employee._id.toString(),
          email,
          message: 'Employee email is invalid',
        });
        continue;
      }

      const inv = employee.invitationId;

      if (inv && typeof inv === 'object' && inv !== null && 'status' in inv) {
        const pop = inv as PopulatedInvitation;
        if (pop.status === 'accepted') continue;
        if (pop.status === 'pending') {
          eligibleResend.push({ employee, invitation: pop });
          continue;
        }
        eligibleNew.push(employee);
        continue;
      }

      eligibleNew.push(employee);
    }

    const organization =
      await OrganizationModel.findById(organizationId).lean();
    const teamName = organization?.name?.trim() ?? '';
    const frontendBase = origin?.trim() ?? '';

    const inviterEmail = user.email?.trim() || '';
    const inviterNameFromUser =
      user.name?.trim() === '' ? undefined : user.name?.trim();
    const inviterDisplayName =
      inviterNameFromUser || (inviterEmail ? inviterEmail.split('@')[0] : '');

    const globalReason = !organization
      ? 'Organization not found'
      : !teamName
        ? 'Organization name is not set'
        : !inviterEmail
          ? 'Your account email is missing; cannot send invitation with inviter details'
          : !inviterDisplayName
            ? 'Could not resolve inviter display name for the invitation email'
            : !frontendBase
              ? 'FRONTEND_URL is not configured'
              : null;

    const notifyTargets = [
      ...eligibleNew,
      ...eligibleResend.map((r) => r.employee),
    ];

    if (globalReason) {
      for (const c of notifyTargets) {
        errors.push({
          employeeId: c._id.toString(),
          email: c.email?.trim(),
          message: globalReason,
        });
      }
      return {
        employeeToInvite: [] as Employee[],
        errors,
      };
    }

    if (!notifyTargets.length) {
      return {
        employeeToInvite: [] as Employee[],
        errors,
      };
    }

    const inviterId = new mongoose.Types.ObjectId(user.id);
    const orgId = new mongoose.Types.ObjectId(organizationId);
    const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    const newInvitations =
      eligibleNew.length > 0
        ? await InvitationModel.insertMany(
            eligibleNew.map((employee) => ({
              email: employee.email!.trim().toLowerCase(),
              inviterId,
              organizationId: orgId,
              role: 'staff',
              status: 'pending' as const,
              expiresAt,
            }))
          )
        : [];

    if (eligibleNew.length > 0) {
      await EmployeeModal.bulkWrite(
        newInvitations.map((invitation, index) => ({
          updateOne: {
            filter: { _id: eligibleNew[index]._id },
            update: { $set: { invitationId: invitation._id } },
          },
        })) as Parameters<typeof EmployeeModal.bulkWrite>[0]
      );
    }

    type EmailJob = {
      employee: EmployeeDoc;
      invitationEmail: string;
      invitationId: mongoose.Types.ObjectId;
      isNewInvite: boolean;
    };

    const emailJobs: EmailJob[] = [];

    for (let i = 0; i < newInvitations.length; i++) {
      emailJobs.push({
        employee: eligibleNew[i],
        invitationEmail: newInvitations[i].email,
        invitationId: newInvitations[i]._id as mongoose.Types.ObjectId,
        isNewInvite: true,
      });
    }
    for (const { employee, invitation } of eligibleResend) {
      emailJobs.push({
        employee,
        invitationEmail: invitation.email,
        invitationId: invitation._id,
        isNewInvite: false,
      });
    }

    const invitationEmailsForLookup = [
      ...new Set(emailJobs.map((j) => j.invitationEmail.toLowerCase())),
    ];
    const existingUsers = await UserModel.find({
      email: { $in: invitationEmailsForLookup },
    })
      .select('email')
      .lean();
    const emailsWithAccount = new Set(
      existingUsers.map((u) => u.email?.toLowerCase()).filter(Boolean)
    );

    const EMAIL_CONCURRENCY = 8;
    const results: PromiseSettledResult<boolean>[] = [];
    for (let i = 0; i < emailJobs.length; i += EMAIL_CONCURRENCY) {
      const batch = emailJobs.slice(i, i + EMAIL_CONCURRENCY);
      const batchSettled = await Promise.allSettled(
        batch.map((job) => {
          const inviteLink = emailsWithAccount.has(
            job.invitationEmail.toLowerCase()
          )
            ? `${frontendBase}/auth/organization/invitation/${job.invitationId.toString()}`
            : frontendBase;
          return emailTemplates.sendOrganizationInvitationEmail(
            job.invitationEmail,
            {
              invitedByUsername: inviterDisplayName,
              invitedByEmail: inviterEmail,
              teamName,
              inviteLink,
            }
          );
        })
      );
      results.push(...batchSettled);
    }

    const emailFailures = results
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => r.status === 'rejected');

    for (const { r, index } of emailFailures) {
      if (r.status !== 'rejected') continue;
      const job = emailJobs[index];
      const reason = r.reason;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : JSON.stringify(reason);

      errors.push({
        employeeId: job.employee._id.toString(),
        email: job.employee.email?.trim(),
        message: `Email could not be sent: ${msg}`,
      });

      logger.error(
        `Invitation email failed: ${msg}`,
        reason instanceof Error ? reason : undefined
      );

      if (!job.isNewInvite) continue;

      try {
        await EmployeeModal.findByIdAndUpdate(job.employee._id, {
          $unset: { invitationId: 1 },
        });
        await InvitationModel.deleteOne({ _id: job.invitationId });
      } catch (cleanupErr) {
        logger.error(
          'Failed to roll back invitation after email error',
          cleanupErr instanceof Error ? cleanupErr : undefined
        );
      }
    }

    const succeededIndices = new Set(
      results
        .map((r, i) => (r.status === 'fulfilled' ? i : -1))
        .filter((i) => i >= 0)
    );

    const employeeToInvite = emailJobs
      .filter((_, i) => succeededIndices.has(i))
      .map((job) => {
        const c = job.employee;
        return {
          id: c._id.toString(),
          name: c.name,
          email: c.email,
          phone: c.phone,
          department: String(c.department),
          departmentRole: c.departmentRole,
        };
      }) as unknown as Employee[];

    return { employeeToInvite, errors };
  }
}
