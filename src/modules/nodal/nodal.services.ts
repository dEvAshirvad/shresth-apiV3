import { User } from '@/types/global';
import {
  Invitation,
  InvitationModel,
} from '../auth/invitations/invitations.model';
import {
  NodalDepartmentCreate,
  NodalDepartmentUpdate,
  NodalModal,
  type Nodal,
} from './nodal.model';
import mongoose, { isValidObjectId } from 'mongoose';
import APIError from '@/configs/errors/APIError';
import emailTemplates from '@/configs/emailTemplates';
import { UserModel } from '../auth/users/users.model';
import { OrganizationModel } from '../auth/organizations/organizations.model';
import { MemberModel } from '../auth/members/members.model';
import logger from '@/configs/logger/winston';
import { z } from 'zod';
import { DepartmentModel } from '../departments/departments.model';

export interface InvitationNodalError {
  nodalId: string;
  email?: string;
  message: string;
}

export interface SyncNodalUserMemberSkip {
  nodalId: string;
  email?: string;
  reason: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface NodalImportRow {
  name: string;
  phone: string;
  email?: string;
  departmentRole?: string;
}

export class NodalService {
  static async amIAssigned(userId?: string) {
    const adminMember = await MemberModel.findOne({
      role: { $in: ['admin', 'owner'] },
    } as any)
      .populate('userId', 'email')
      .lean();
    const adminEmail =
      adminMember &&
      typeof adminMember === 'object' &&
      'userId' in adminMember &&
      (adminMember as any).userId &&
      typeof (adminMember as any).userId === 'object'
        ? String((adminMember as any).userId.email || '')
        : '';

    const nodal = await NodalModal.findOne({ userId }).lean();
    if (!nodal) {
      return {
        isAssigned: false,
        message: `Could not find nodal record for user ${userId} or user is not assigned as nodal. Contact Admin or Owner to get access to the system ${adminEmail}`,
      };
    }
    const department = await DepartmentModel.findOne({
      assignedNodal: nodal?.memberId,
    }).lean();
    if (!department) {
      return {
        isAssigned: false,
        message: `User ${userId} is assigned as nodal but not assigned to any department. Contact Admin or Owner to get access to the system ${adminEmail}`,
      };
    }
    return nodal;
  }

  static async createNodal(payload: NodalDepartmentCreate) {
    if (!isValidObjectId(payload.organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization ID',
      });
    }
    const nodal = await NodalModal.create(payload);
    return nodal;
  }

  static async getNodal(id: string) {
    const nodal = await NodalModal.findById(id)
      .populate('invitationId')
      .populate('userId')
      .lean();
    return nodal;
  }

  static async getNodals({
    page = 1,
    limit = 10,
    search = '',
    organizationId,
  }: {
    page?: number;
    limit?: number;
    search?: string;
    organizationId: string;
  }) {
    const filter: Record<string, unknown> = {
      organizationId,
    };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      NodalModal.find(filter)
        .populate('invitationId')
        .populate('userId')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NodalModal.countDocuments(filter),
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

  static async updateNodal(id: string, update: NodalDepartmentUpdate) {
    const nodal = await NodalModal.findByIdAndUpdate(
      id,
      { $set: update },
      {
        new: true,
      }
    ).lean();
    return nodal;
  }

  static async deleteNodal(id: string) {
    const nodal = await NodalModal.findByIdAndDelete(id).lean();
    return nodal;
  }

  static async importNodals(rows: NodalImportRow[], organizationId: string) {
    if (!rows.length) {
      return { insertedCount: 0, updatedCount: 0 };
    }

    if (!isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const orgOid = new mongoose.Types.ObjectId(organizationId);
    let insertedCount = 0;
    let updatedCount = 0;

    for (const row of rows) {
      const updateDoc: Record<string, unknown> = {
        name: row.name,
        email: row.email,
        phone: row.phone,
        organizationId: orgOid,
      };

      const existing = await NodalModal.findOneAndUpdate(
        { phone: row.phone, organizationId: orgOid } as any,
        { $set: updateDoc },
        { upsert: true, new: false }
      ).lean();

      if (existing) updatedCount += 1;
      else insertedCount += 1;
    }

    return { insertedCount, updatedCount };
  }

  /**
   * Same as **`EmployeeService.syncUserAndMemberFromEmails`** for **`tb_nodals`** rows.
   */
  static async syncUserAndMemberFromEmails(
    organizationId: string
  ): Promise<{ linked: number; skipped: SyncNodalUserMemberSkip[] }> {
    if (!isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const orgOid = new mongoose.Types.ObjectId(organizationId);

    const nodals = await NodalModal.find({ organizationId })
      .select('_id email userId memberId')
      .lean();

    const skipped: SyncNodalUserMemberSkip[] = [];
    let linked = 0;

    for (const row of nodals) {
      const id = String((row as any)._id);
      const email = (row as any).email?.trim();
      const existingUid = (row as any).userId;
      const existingMid = (row as any).memberId;

      if (existingUid && existingMid) {
        skipped.push({
          nodalId: id,
          email: email || undefined,
          reason: 'Already has userId and memberId',
        });
        continue;
      }
      if (!email) {
        skipped.push({ nodalId: id, reason: 'No email on record' });
        continue;
      }

      const user = await UserModel.findOne({
        email: new RegExp(`^${escapeRegex(email)}$`, 'i'),
      } as any)
        .select('_id')
        .lean();

      if (!user) {
        skipped.push({
          nodalId: id,
          email,
          reason: 'No user with this email',
        });
        continue;
      }

      const userId = (user as any)._id;
      if (existingUid && String(existingUid) !== String(userId)) {
        skipped.push({
          nodalId: id,
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
          nodalId: id,
          email,
          reason: 'User is not a member of this organization',
        });
        continue;
      }

      await NodalModal.updateOne({ _id: (row as any)._id } as any, {
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
   * Sets **`userId`** and **`memberId`** on one nodal row; same validation as employee attach
   * for departments and members.
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

    const nodal = await NodalModal.findOne({ email }).select('email').lean();
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

    const updated = await NodalModal.findOneAndUpdate(
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

  /**
   * For all nodal rows in the **organization** (no department filter), send org invitations with role **`nodal`**.
   * Mirrors `EmployeeService.sendInvitationToRestEmployees` but uses **`role: 'nodal'`** on `InvitationModel`.
   */
  static async sendInvitationToRestNodals(
    organizationId: string,
    user?: User,
    origin?: string
  ) {
    if (!isValidObjectId(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_IDS',
        MESSAGE: 'Invalid organization id',
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

    type NodalDoc = mongoose.FlattenMaps<Nodal> & {
      _id: mongoose.Types.ObjectId;
      invitationId?: mongoose.Types.ObjectId | PopulatedInvitation | null;
      userId?: unknown;
    };

    const orgOid = new mongoose.Types.ObjectId(organizationId);

    const nodals = await NodalModal.find({
      organizationId: orgOid,
    } as any)
      .select('name email phone invitationId userId organizationId')
      .populate('invitationId')
      .limit(500)
      .lean<NodalDoc[]>();

    const errors: InvitationNodalError[] = [];
    const eligibleNew: NodalDoc[] = [];
    const eligibleResend: {
      nodal: NodalDoc;
      invitation: PopulatedInvitation;
    }[] = [];

    for (const nodal of nodals) {
      if (nodal.userId) continue;

      const email = nodal.email?.trim();
      if (!email) {
        errors.push({
          nodalId: nodal._id.toString(),
          message: 'Nodal record has no email address',
        });
        continue;
      }
      if (!z.string().email().safeParse(email).success) {
        errors.push({
          nodalId: nodal._id.toString(),
          email,
          message: 'Email is invalid',
        });
        continue;
      }

      const inv = nodal.invitationId;

      if (inv && typeof inv === 'object' && inv !== null && 'status' in inv) {
        const pop = inv as PopulatedInvitation;
        if (pop.status === 'accepted') continue;
        if (pop.status === 'pending') {
          eligibleResend.push({ nodal, invitation: pop });
          continue;
        }
        eligibleNew.push(nodal);
        continue;
      }

      eligibleNew.push(nodal);
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
      ...eligibleResend.map((r) => r.nodal),
    ];

    if (globalReason) {
      for (const c of notifyTargets) {
        errors.push({
          nodalId: c._id.toString(),
          email: c.email?.trim(),
          message: globalReason,
        });
      }
      return {
        nodalToInvite: [] as Nodal[],
        errors,
      };
    }

    if (!notifyTargets.length) {
      return {
        nodalToInvite: [] as Nodal[],
        errors,
      };
    }

    const inviterId = new mongoose.Types.ObjectId(user.id);
    const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    const newInvitations =
      eligibleNew.length > 0
        ? await InvitationModel.insertMany(
            eligibleNew.map((n) => ({
              email: n.email!.trim().toLowerCase(),
              inviterId,
              organizationId: orgOid,
              role: 'nodal',
              status: 'pending' as const,
              expiresAt,
            }))
          )
        : [];

    if (eligibleNew.length > 0) {
      await NodalModal.bulkWrite(
        newInvitations.map((invitation, index) => ({
          updateOne: {
            filter: { _id: eligibleNew[index]._id },
            update: { $set: { invitationId: invitation._id } },
          },
        })) as Parameters<typeof NodalModal.bulkWrite>[0]
      );
    }

    type EmailJob = {
      nodal: NodalDoc;
      invitationEmail: string;
      invitationId: mongoose.Types.ObjectId;
      isNewInvite: boolean;
    };

    const emailJobs: EmailJob[] = [];

    for (let i = 0; i < newInvitations.length; i++) {
      emailJobs.push({
        nodal: eligibleNew[i],
        invitationEmail: newInvitations[i].email,
        invitationId: newInvitations[i]._id as mongoose.Types.ObjectId,
        isNewInvite: true,
      });
    }
    for (const { nodal, invitation } of eligibleResend) {
      emailJobs.push({
        nodal,
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
        nodalId: job.nodal._id.toString(),
        email: job.nodal.email?.trim(),
        message: `Email could not be sent: ${msg}`,
      });

      logger.error(
        `Nodal invitation email failed: ${msg}`,
        reason instanceof Error ? reason : undefined
      );

      if (!job.isNewInvite) continue;

      try {
        await NodalModal.findByIdAndUpdate(job.nodal._id, {
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

    const nodalToInvite = emailJobs
      .filter((_, i) => succeededIndices.has(i))
      .map((job) => {
        const c = job.nodal;
        return {
          id: c._id.toString(),
          name: c.name,
          email: c.email,
          phone: c.phone,
        };
      }) as unknown as Nodal[];

    return { nodalToInvite, errors };
  }
}
