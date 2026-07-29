import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import APIError from '@/configs/errors/APIError';
import logger from '@/configs/logger/winston';
import { OrganizationModel } from '@/modules/auth/organizations/organizations.model';
import { UserModel } from '@/modules/auth/users/users.model';
import { MemberModel } from '@/modules/auth/members/members.model';
import { DepartmentModel } from '@/modules/departments/departments.model';
import { EmployeeModal } from './employee.model';
import { NodalModal } from '@/modules/nodal/nodal.model';

export type EmployeeCredentialExportRow = {
  name: string;
  phone: string;
  email: string;
  empId: string;
  password: string;
};

export interface EmployeeCredentialPayload extends EmployeeCredentialExportRow {
  employeeId: string;
}

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generatePassword(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return out;
}

function slugPart(raw: string, max = 16): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s.slice(0, max) || 'dept').replace(/^_+|_+$/g, '') || 'dept';
}

async function setUserPassword(userId: string, password: string) {
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(password);
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  const credential = accounts.find((a) => a.providerId === 'credential');
  if (credential) {
    await ctx.internalAdapter.updatePassword(userId, hashed);
  } else {
    await ctx.internalAdapter.linkAccount({
      accountId: userId,
      providerId: 'credential',
      password: hashed,
      userId,
    });
  }
}

/**
 * `{orgPrefix}_{deptShort}_{NNNN}` — globally unique Better Auth username.
 */
export async function generateEmployeeEmpId(params: {
  organizationId: string;
  departmentId: string;
}): Promise<string> {
  const [org, dept] = await Promise.all([
    OrganizationModel.findById(params.organizationId).select('orgCode').lean(),
    DepartmentModel.findById(params.departmentId).select('name slug').lean(),
  ]);

  const orgPrefix = slugPart(
    String((org as any)?.orgCode || params.organizationId.slice(-6)),
    24
  );
  const deptShort = slugPart(
    String((dept as any)?.slug || (dept as any)?.name || 'dept'),
    16
  );
  const prefix = `${orgPrefix}_${deptShort}`;

  const existing = await EmployeeModal.find({
    empId: { $regex: `^${prefix}_\\d+$` },
  })
    .select('empId')
    .lean();

  let maxSeq = 0;
  for (const row of existing) {
    const empId = String((row as any).empId || '');
    const m = empId.match(/_(\d+)$/);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1]!, 10));
  }

  for (let attempt = 1; attempt <= 50; attempt++) {
    const seq = String(maxSeq + attempt).padStart(4, '0');
    const candidate = `${prefix}_${seq}`;
    const clash =
      (await EmployeeModal.exists({ empId: candidate })) ||
      (await NodalModal.exists({ empId: candidate })) ||
      (await UserModel.exists({ username: candidate }));
    if (!clash) return candidate;
  }

  throw new APIError({
    STATUS: 500,
    TITLE: 'EMP_ID_GENERATION_FAILED',
    MESSAGE: 'Could not generate a unique employee empId',
  });
}

export async function rotateEmployeePasswordFast(row: {
  name?: string;
  phone?: string;
  email?: string;
  empId: string;
  userId: string;
}): Promise<EmployeeCredentialExportRow> {
  const password = generatePassword(10);
  await setUserPassword(String(row.userId), password);
  return {
    name: String(row.name || '').trim() || 'Employee',
    phone: String(row.phone || '').trim(),
    email: String(row.email || '').trim(),
    empId: String(row.empId).trim(),
    password,
  };
}

export async function provisionEmployeeCredentials(params: {
  employeeId: string;
  organizationId: string;
  rotatePassword?: boolean;
}): Promise<EmployeeCredentialPayload> {
  const employee = await EmployeeModal.findById(params.employeeId)
    .populate('department')
    .lean();
  if (!employee) {
    throw new APIError({
      STATUS: 404,
      TITLE: 'EMPLOYEE_NOT_FOUND',
      MESSAGE: 'Employee record not found',
    });
  }

  const dept = (employee as any).department;
  const departmentId = String(dept?._id || dept || '');
  const deptOrgId = String(dept?.organizationId || '');
  if (!departmentId || deptOrgId !== String(params.organizationId)) {
    throw new APIError({
      STATUS: 403,
      TITLE: 'EMPLOYEE_ORG_MISMATCH',
      MESSAGE: 'Employee does not belong to the active organization',
    });
  }

  const name = String((employee as any).name || '').trim() || 'Employee';
  const phone = String((employee as any).phone || '').trim();
  const existingEmail =
    String((employee as any).email || '').trim() || undefined;
  let empId = String((employee as any).empId || '').trim();
  let userId = (employee as any).userId
    ? String((employee as any).userId)
    : '';
  let memberId = (employee as any).memberId
    ? String((employee as any).memberId)
    : '';

  const password = generatePassword(10);

  if (userId && !params.rotatePassword && memberId && empId) {
    throw new APIError({
      STATUS: 409,
      TITLE: 'EMPLOYEE_ALREADY_PROVISIONED',
      MESSAGE:
        'Employee already has credentials. Use reset-password to rotate the password.',
    });
  }

  if (!empId) {
    empId = await generateEmployeeEmpId({
      organizationId: params.organizationId,
      departmentId,
    });
  }

  const syntheticEmail = `${empId.replace(/[^a-zA-Z0-9._-]/g, '_')}@staff.local`;

  if (!userId) {
    const created = await auth.api.createUser({
      body: {
        email: syntheticEmail,
        password,
        name,
        role: 'user',
        data: {
          username: empId,
          displayUsername: empId,
          isOnboarded: true,
          emailVerified: true,
        },
      },
    });

    userId = String((created as any)?.user?.id || (created as any)?.id || '');
    if (!userId) {
      throw new APIError({
        STATUS: 500,
        TITLE: 'USER_CREATE_FAILED',
        MESSAGE: 'Better Auth createUser did not return a user id',
      });
    }

    await UserModel.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          username: empId,
          displayUsername: empId,
          isOnboarded: true,
          emailVerified: true,
        },
      }
    );

    try {
      const member = await auth.api.addMember({
        body: {
          userId,
          organizationId: params.organizationId,
          role: 'staff' as 'member',
        },
      });
      memberId = String((member as any)?.id || '');
    } catch (err) {
      logger.error(`addMember failed for employee=${params.employeeId}`, err);
      throw new APIError({
        STATUS: 500,
        TITLE: 'MEMBER_CREATE_FAILED',
        MESSAGE:
          err instanceof Error
            ? err.message
            : 'Failed to add employee as organization member',
      });
    }

    if (!memberId) {
      throw new APIError({
        STATUS: 500,
        TITLE: 'MEMBER_CREATE_FAILED',
        MESSAGE: 'addMember did not return a member id',
      });
    }
  } else {
    await UserModel.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          username: empId,
          displayUsername: empId,
          isOnboarded: true,
          emailVerified: true,
        },
      }
    );
    await setUserPassword(userId, password);

    if (!memberId) {
      try {
        const member = await auth.api.addMember({
          body: {
            userId,
            organizationId: params.organizationId,
            role: 'staff' as 'member',
          },
        });
        memberId = String((member as any)?.id || '');
      } catch (err) {
        const existing = await MemberModel.findOne({
          userId: new mongoose.Types.ObjectId(userId),
          organizationId: new mongoose.Types.ObjectId(params.organizationId),
        } as any)
          .select('_id')
          .lean();
        memberId = existing ? String((existing as any)._id) : '';
        if (!memberId) throw err;
      }
    }
  }

  await EmployeeModal.updateOne(
    { _id: params.employeeId },
    {
      $set: {
        empId,
        userId: new mongoose.Types.ObjectId(userId),
        memberId: new mongoose.Types.ObjectId(memberId),
      },
      $unset: { invitationId: 1 },
    }
  );

  return {
    employeeId: String(params.employeeId),
    name,
    phone,
    email: existingEmail || '',
    empId,
    password,
  };
}

export async function resetEmployeePassword(params: {
  employeeId: string;
  organizationId: string;
}): Promise<EmployeeCredentialPayload> {
  return provisionEmployeeCredentials({
    ...params,
    rotatePassword: true,
  });
}
