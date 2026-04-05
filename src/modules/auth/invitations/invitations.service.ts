import mongoose from 'mongoose';
import { z } from 'zod';
import APIError from '@/configs/errors/APIError';
import emailTemplates from '@/configs/emailTemplates';
import logger from '@/configs/logger/winston';
import { OrganizationModel } from '../organizations/organizations.model';
import { UserModel } from '../users/users.model';
import { MemberModel } from '../members/members.model';
import { InvitationModel } from './invitations.model';
import { User } from '@/types/global';

/** Bulk org-invitation import accepts **`admin`** role only (nodals use department nodal import + send flow). */
export type OrgInviteRole = 'admin';

/** Parsed from CSV/XLSX; `role` must be **`admin`**. */
export interface InvitationImportRow {
  email: string;
  role: string;
}

export type InvitationImportSkipReason =
  | 'already_member'
  | 'invitation_already_accepted'
  | 'duplicate_email_in_file';

export interface InvitationImportError {
  email?: string;
  row?: number;
  message: string;
}

export interface InvitationImportSkipped {
  email: string;
  reason: InvitationImportSkipReason;
}

export interface InvitationImportResult {
  created: number;
  resent: number;
  skipped: InvitationImportSkipped[];
  errors: InvitationImportError[];
  emailFailures: Array<{ email: string; message: string }>;
}

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_CONCURRENCY = 8;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function parseRole(raw: string): OrgInviteRole | null {
  const r = raw.trim().toLowerCase();
  if (r === 'admin') return 'admin';
  return null;
}

async function sendInvitationEmailsBatch(params: {
  jobs: Array<{ email: string; invitationId: mongoose.Types.ObjectId }>;
  inviterDisplayName: string;
  inviterEmail: string;
  teamName: string;
  frontendBase: string;
}) {
  const { jobs, inviterDisplayName, inviterEmail, teamName, frontendBase } =
    params;

  const invitationEmailsForLookup = [
    ...new Set(jobs.map((j) => j.email.toLowerCase())),
  ];
  const existingUsers = await UserModel.find({
    email: { $in: invitationEmailsForLookup },
  })
    .select('email')
    .lean();
  const emailsWithAccount = new Set(
    existingUsers.map((u) => u.email?.toLowerCase()).filter(Boolean)
  );

  const results: PromiseSettledResult<boolean>[] = [];
  for (let i = 0; i < jobs.length; i += EMAIL_CONCURRENCY) {
    const batch = jobs.slice(i, i + EMAIL_CONCURRENCY);
    const batchSettled = await Promise.allSettled(
      batch.map((job) => {
        const inviteLink = emailsWithAccount.has(job.email.toLowerCase())
          ? `${frontendBase}/auth/organization/invitation/${job.invitationId.toString()}`
          : frontendBase;
        return emailTemplates.sendOrganizationInvitationEmail(job.email, {
          invitedByUsername: inviterDisplayName,
          invitedByEmail: inviterEmail,
          teamName,
          inviteLink,
        });
      })
    );
    results.push(...batchSettled);
  }

  const emailFailures: Array<{ email: string; message: string }> = [];
  results.forEach((r, index) => {
    if (r.status !== 'rejected') return;
    const job = jobs[index];
    const reason = r.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : JSON.stringify(reason);
    emailFailures.push({ email: job.email, message: msg });
    logger.error(
      `Organization invitation email failed for ${job.email}: ${msg}`,
      reason instanceof Error ? reason : undefined
    );
  });

  return emailFailures;
}

const INVITATION_LIST_FIELDS = [
  'email',
  'inviterId',
  'role',
  'status',
  'expiresAt',
  'createdAt',
] as const;
export type InvitationListField = (typeof INVITATION_LIST_FIELDS)[number];

export type InvitationFilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

export interface ListInvitationsParams {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  filterField?: string;
  filterOperator?: InvitationFilterOperator;
  filterValue?: unknown;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VALID_FILTER_OPERATORS: InvitationFilterOperator[] = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'ends_with',
];

function isValidFilterOperator(s: string): s is InvitationFilterOperator {
  return (VALID_FILTER_OPERATORS as readonly string[]).includes(s);
}

/** Parse `filterValue` from a query string (JSON arrays/objects, booleans, numbers, or plain string). */
export function parseInvitationQueryFilterValue(
  raw: string | undefined
): unknown {
  if (raw === undefined || raw === '') return undefined;
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (
    (t.startsWith('[') && t.endsWith(']')) ||
    (t.startsWith('{') && t.endsWith('}'))
  ) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function parseDateValue(v: unknown): Date {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_FILTER_VALUE',
        MESSAGE: 'Invalid date number for filter',
      });
    }
    return d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_FILTER_VALUE',
        MESSAGE: 'Invalid date string for filter',
      });
    }
    return d;
  }
  throw new APIError({
    STATUS: 400,
    TITLE: 'INVALID_FILTER_VALUE',
    MESSAGE: 'Date filter requires a string, number, or Date',
  });
}

function parseObjectIdValue(v: unknown): mongoose.Types.ObjectId {
  if (v instanceof mongoose.Types.ObjectId) return v;
  if (typeof v === 'string' && mongoose.Types.ObjectId.isValid(v)) {
    return new mongoose.Types.ObjectId(v);
  }
  throw new APIError({
    STATUS: 400,
    TITLE: 'INVALID_FILTER_VALUE',
    MESSAGE: 'inviterId filter requires a valid ObjectId string',
  });
}

function buildInvitationFilter(
  field: InvitationListField,
  operator: InvitationFilterOperator,
  value: unknown
): Record<string, unknown> {
  const stringFields: InvitationListField[] = ['email', 'role', 'status'];
  const oidFields: InvitationListField[] = ['inviterId'];
  const dateFields: InvitationListField[] = ['expiresAt', 'createdAt'];

  if (stringFields.includes(field)) {
    const normEmail = (s: string) => s.trim().toLowerCase();
    const str = (x: unknown) => String(x);

    switch (operator) {
      case 'eq':
        return {
          [field]:
            field === 'email' ? normEmail(str(value)) : str(value),
        };
      case 'ne':
        return {
          [field]:
            field === 'email'
              ? { $ne: normEmail(str(value)) }
              : { $ne: str(value) },
        };
      case 'lt':
        return { [field]: { $lt: str(value) } };
      case 'lte':
        return { [field]: { $lte: str(value) } };
      case 'gt':
        return { [field]: { $gt: str(value) } };
      case 'gte':
        return { [field]: { $gte: str(value) } };
      case 'in': {
        if (!Array.isArray(value) || !value.length) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'INVALID_FILTER_VALUE',
            MESSAGE: 'in / not_in require a non-empty array',
          });
        }
        const arr = value.map((v) =>
          field === 'email' ? normEmail(str(v)) : str(v)
        );
        return { [field]: { $in: arr } };
      }
      case 'not_in': {
        if (!Array.isArray(value) || !value.length) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'INVALID_FILTER_VALUE',
            MESSAGE: 'in / not_in require a non-empty array',
          });
        }
        const arr = value.map((v) =>
          field === 'email' ? normEmail(str(v)) : str(v)
        );
        return { [field]: { $nin: arr } };
      }
      case 'contains':
        return {
          [field]: {
            $regex: escapeRegex(str(value)),
            $options: 'i',
          },
        };
      case 'starts_with':
        return {
          [field]: {
            $regex: `^${escapeRegex(str(value))}`,
            $options: 'i',
          },
        };
      case 'ends_with':
        return {
          [field]: {
            $regex: `${escapeRegex(str(value))}$`,
            $options: 'i',
          },
        };
      default:
        throw new APIError({
          STATUS: 400,
          TITLE: 'UNSUPPORTED_FILTER',
          MESSAGE: `Operator ${operator} is not supported for ${field}`,
        });
    }
  }

  if (oidFields.includes(field)) {
    switch (operator) {
      case 'eq':
        return { [field]: parseObjectIdValue(value) };
      case 'ne':
        return { [field]: { $ne: parseObjectIdValue(value) } };
      case 'in': {
        if (!Array.isArray(value) || !value.length) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'INVALID_FILTER_VALUE',
            MESSAGE: 'in / not_in require a non-empty array of ObjectIds',
          });
        }
        return {
          [field]: { $in: value.map((v) => parseObjectIdValue(v)) },
        };
      }
      case 'not_in': {
        if (!Array.isArray(value) || !value.length) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'INVALID_FILTER_VALUE',
            MESSAGE: 'in / not_in require a non-empty array of ObjectIds',
          });
        }
        return {
          [field]: { $nin: value.map((v) => parseObjectIdValue(v)) },
        };
      }
      default:
        throw new APIError({
          STATUS: 400,
          TITLE: 'UNSUPPORTED_FILTER',
          MESSAGE: `Operator ${operator} is not supported for inviterId (use eq, ne, in, not_in)`,
        });
    }
  }

  if (dateFields.includes(field)) {
    switch (operator) {
      case 'eq':
        return { [field]: parseDateValue(value) };
      case 'ne':
        return { [field]: { $ne: parseDateValue(value) } };
      case 'lt':
        return { [field]: { $lt: parseDateValue(value) } };
      case 'lte':
        return { [field]: { $lte: parseDateValue(value) } };
      case 'gt':
        return { [field]: { $gt: parseDateValue(value) } };
      case 'gte':
        return { [field]: { $gte: parseDateValue(value) } };
      case 'in': {
        if (!Array.isArray(value) || !value.length) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'INVALID_FILTER_VALUE',
            MESSAGE: 'in / not_in require a non-empty array of dates',
          });
        }
        return {
          [field]: { $in: value.map((v) => parseDateValue(v)) },
        };
      }
      case 'not_in': {
        if (!Array.isArray(value) || !value.length) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'INVALID_FILTER_VALUE',
            MESSAGE: 'in / not_in require a non-empty array of dates',
          });
        }
        return {
          [field]: { $nin: value.map((v) => parseDateValue(v)) },
        };
      }
      default:
        throw new APIError({
          STATUS: 400,
          TITLE: 'UNSUPPORTED_FILTER',
          MESSAGE: `Operator ${operator} is not supported for ${field} (use comparison or in / not_in)`,
        });
    }
  }

  throw new APIError({
    STATUS: 400,
    TITLE: 'INVALID_FILTER_FIELD',
    MESSAGE: `Unknown filter field: ${field}`,
  });
}

export class InvitationService {
  /**
   * Paginated list of invitations for the active organization (same query shape as Better Auth list-members).
   */
  static async listInvitations(
    organizationId: string,
    params: ListInvitationsParams
  ) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const orgOid = new mongoose.Types.ObjectId(organizationId);
    const baseFilter: Record<string, unknown> = { organizationId: orgOid };

    const limitRaw = params.limit;
    const limit =
      limitRaw !== undefined && limitRaw > 0
        ? Math.min(100, Math.floor(limitRaw))
        : 20;
    const offset =
      params.offset !== undefined && params.offset >= 0
        ? Math.floor(params.offset)
        : 0;

    const sortBy = params.sortBy || 'createdAt';
    if (!INVITATION_LIST_FIELDS.includes(sortBy as InvitationListField)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_SORT_FIELD',
        MESSAGE: `sortBy must be one of: ${INVITATION_LIST_FIELDS.join(', ')}`,
      });
    }

    const sortDirection = params.sortDirection === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortDirection,
    };

    let filter: Record<string, unknown> = { ...baseFilter };

    if (params.filterField) {
      const field = params.filterField as InvitationListField;
      if (!INVITATION_LIST_FIELDS.includes(field)) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'INVALID_FILTER_FIELD',
          MESSAGE: `filterField must be one of: ${INVITATION_LIST_FIELDS.join(', ')}`,
        });
      }
      const opRaw = params.filterOperator ?? 'eq';
      if (!isValidFilterOperator(String(opRaw))) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'INVALID_FILTER_OPERATOR',
          MESSAGE: `filterOperator must be one of: ${VALID_FILTER_OPERATORS.join(', ')}`,
        });
      }
      const op = opRaw as InvitationFilterOperator;
      if (params.filterValue === undefined) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'INVALID_FILTER',
          MESSAGE: 'filterValue is required when filterField is set',
        });
      }
      const extra = buildInvitationFilter(field, op, params.filterValue);
      filter = { ...filter, ...extra };
    }

    const [invitations, total] = await Promise.all([
      InvitationModel.find(filter)
        .sort(sort)
        .skip(offset)
        .limit(limit)
        .lean(),
      InvitationModel.countDocuments(filter),
    ]);

    return {
      invitations,
      total,
      limit,
      offset,
    };
  }

  /**
   * Bulk import: **`admin`** org-role invitations only (CSV `role` column).
   * Caller must be org **owner** or **admin** (enforced by route middleware).
   * - Skips users who are already org members.
   * - Pending invite for same email → resends email and refreshes expiry.
   */
  static async importAdminInvitations(
    rows: InvitationImportRow[],
    organizationId: string,
    user: User | undefined,
    origin?: string
  ): Promise<InvitationImportResult> {
    if (!rows.length) {
      return {
        created: 0,
        resent: 0,
        skipped: [],
        errors: [],
        emailFailures: [],
      };
    }

    if (!user?.id) {
      throw new APIError({
        STATUS: 401,
        TITLE: 'INVITER_REQUIRED',
        MESSAGE: 'Authenticated user is required to send invitations',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const organization = await OrganizationModel.findById(organizationId).lean();
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
          ? 'Your account email is missing; cannot send invitation'
          : !inviterDisplayName
            ? 'Could not resolve inviter display name'
            : !frontendBase
              ? 'Request Origin header is missing (needed for invitation links)'
              : null;

    const errors: InvitationImportError[] = [];
    const skipped: InvitationImportSkipped[] = [];
    const seen = new Set<string>();

    if (globalReason) {
      rows.forEach((row, idx) => {
        errors.push({
          row: idx + 1,
          email: row.email,
          message: globalReason,
        });
      });
      return {
        created: 0,
        resent: 0,
        skipped,
        errors,
        emailFailures: [],
      };
    }

    const inviterId = new mongoose.Types.ObjectId(user.id);
    const orgId = new mongoose.Types.ObjectId(organizationId);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

    type PendingCreate = {
      email: string;
      role: OrgInviteRole;
    };
    type PendingResend = {
      email: string;
      invitationId: mongoose.Types.ObjectId;
      role: OrgInviteRole;
    };

    const toCreate: PendingCreate[] = [];
    const toResend: PendingResend[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const emailNorm = normalizeEmail(row.email);

      if (!emailNorm) {
        errors.push({ row: rowNum, message: 'email is required' });
        continue;
      }

      if (!z.string().email().safeParse(emailNorm).success) {
        errors.push({ row: rowNum, email: emailNorm, message: 'Invalid email' });
        continue;
      }

      const role = parseRole(String(row.role));
      if (!role) {
        errors.push({
          row: rowNum,
          email: emailNorm,
          message: 'role must be admin',
        });
        continue;
      }

      if (seen.has(emailNorm)) {
        skipped.push({ email: emailNorm, reason: 'duplicate_email_in_file' });
        continue;
      }
      seen.add(emailNorm);

      const userDoc = await UserModel.findOne({
        email: new RegExp(`^${emailNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      } as any)
        .select('_id')
        .lean();

      if (userDoc) {
        const member = await MemberModel.findOne({
          organizationId: orgId,
          userId: (userDoc as any)._id,
        } as any)
          .select('_id')
          .lean();
        if (member) {
          skipped.push({ email: emailNorm, reason: 'already_member' });
          continue;
        }
      }

      const existingInv = await InvitationModel.findOne({
        organizationId: orgId,
        email: emailNorm,
      } as any)
        .sort({ createdAt: -1 })
        .lean();

      if (existingInv && (existingInv as any).status === 'accepted') {
        skipped.push({
          email: emailNorm,
          reason: 'invitation_already_accepted',
        });
        continue;
      }

      if (existingInv && (existingInv as any).status === 'pending') {
        await InvitationModel.updateOne(
          { _id: (existingInv as any)._id } as any,
          { $set: { expiresAt, role } }
        );
        toResend.push({
          email: emailNorm,
          invitationId: (existingInv as any)._id,
          role,
        });
        continue;
      }

      toCreate.push({ email: emailNorm, role });
    }

    let created = 0;
    const newJobs: Array<{ email: string; invitationId: mongoose.Types.ObjectId }> =
      [];

    if (toCreate.length > 0) {
      const inserted = await InvitationModel.insertMany(
        toCreate.map((r) => ({
          email: r.email,
          inviterId,
          organizationId: orgId,
          role: r.role,
          status: 'pending' as const,
          expiresAt,
        }))
      );
      created = inserted.length;
      inserted.forEach((doc, i) => {
        newJobs.push({
          email: toCreate[i].email,
          invitationId: doc._id as mongoose.Types.ObjectId,
        });
      });
    }

    const resent = toResend.length;
    const emailJobs = [
      ...newJobs,
      ...toResend.map((r) => ({
        email: r.email,
        invitationId: r.invitationId,
      })),
    ];

    const emailFailures =
      emailJobs.length > 0
        ? await sendInvitationEmailsBatch({
            jobs: emailJobs,
            inviterDisplayName,
            inviterEmail,
            teamName,
            frontendBase,
          })
        : [];

    if (emailFailures.length && newJobs.length) {
      const failedEmails = new Set(emailFailures.map((f) => f.email.toLowerCase()));
      let rolledBack = 0;
      for (const j of newJobs) {
        if (!failedEmails.has(j.email.toLowerCase())) continue;
        try {
          await InvitationModel.deleteOne({ _id: j.invitationId });
          rolledBack += 1;
        } catch (e) {
          logger.error(
            'Failed to delete invitation after email failure',
            e instanceof Error ? e : undefined
          );
        }
      }
      created -= rolledBack;
    }

    return {
      created,
      resent,
      skipped,
      errors,
      emailFailures,
    };
  }
}
