import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import APIError from '@/configs/errors/APIError';
import logger from '@/configs/logger/winston';
import { OrganizationModel } from '@/modules/auth/organizations/organizations.model';
import { UserModel } from '@/modules/auth/users/users.model';
import { MemberModel } from '@/modules/auth/members/members.model';
import { NodalModal } from './nodal.model';

export interface NodalCredentialPayload {
  nodalId: string;
  name: string;
  phone: string;
  email?: string;
  empId: string;
  password: string;
  /** Always skipped — WhatsApp credential campaign returns 401 / not configured. */
  whatsapp: {
    ok: boolean;
    skipped?: boolean;
    message?: string;
    destination?: string;
  };
}

/** Slim row for one-shot credential download (no WhatsApp). */
export type NodalCredentialExportRow = {
  name: string;
  phone: string;
  email: string;
  empId: string;
  password: string;
};

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateNodalPassword(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return out;
}

function generatePassword(length = 10): string {
  return generateNodalPassword(length);
}

function slugOrgPrefix(orgCode?: string | null, organizationId?: string): string {
  const raw = String(orgCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (raw.length >= 2) return raw.slice(0, 24);
  const fallback = String(organizationId || 'org')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toLowerCase();
  return fallback || 'org';
}

/**
 * Next empId for org: `{orgPrefix}_{NNNN}` (globally unique Better Auth username).
 */
export async function generateEmpId(organizationId: string): Promise<string> {
  const org = await OrganizationModel.findById(organizationId)
    .select('orgCode')
    .lean();
  const prefix = slugOrgPrefix((org as any)?.orgCode, organizationId);

  const existing = await NodalModal.find({
    organizationId,
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
      (await NodalModal.exists({ empId: candidate })) ||
      (await UserModel.exists({ username: candidate }));
    if (!clash) return candidate;
  }

  throw new APIError({
    STATUS: 500,
    TITLE: 'EMP_ID_GENERATION_FAILED',
    MESSAGE: 'Could not generate a unique empId',
  });
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
 * Fast path for download-all: rotate password only (no WhatsApp, no re-fetch).
 * Requires existing userId + empId on the nodal row.
 */
export async function rotateNodalPasswordFast(row: {
  name?: string;
  phone?: string;
  email?: string;
  empId: string;
  userId: string;
}): Promise<NodalCredentialExportRow> {
  const password = generateNodalPassword(10);
  await setUserPassword(String(row.userId), password);
  return {
    name: String(row.name || '').trim() || 'Nodal',
    phone: String(row.phone || '').trim(),
    email: String(row.email || '').trim(),
    empId: String(row.empId).trim(),
    password,
  };
}

/**
 * Create Better Auth user + org member (role nodal), link tb_nodals, WhatsApp credentials.
 * Call without request headers so admin createUser skips session auth.
 */
export async function provisionNodalCredentials(params: {
  nodalId: string;
  organizationId: string;
  /** When true, rotate password for already-linked user and refresh empId/username if missing. */
  rotatePassword?: boolean;
  /** @deprecated WhatsApp credential send is disabled (provider 401). Ignored. */
  skipWhatsApp?: boolean;
}): Promise<NodalCredentialPayload> {
  const nodal = await NodalModal.findById(params.nodalId).lean();
  if (!nodal) {
    throw new APIError({
      STATUS: 404,
      TITLE: 'NODAL_NOT_FOUND',
      MESSAGE: 'Nodal record not found',
    });
  }

  if (String((nodal as any).organizationId) !== String(params.organizationId)) {
    throw new APIError({
      STATUS: 403,
      TITLE: 'NODAL_ORG_MISMATCH',
      MESSAGE: 'Nodal does not belong to the active organization',
    });
  }

  const name = String((nodal as any).name || '').trim() || 'Nodal';
  const phone = String((nodal as any).phone || '').trim();
  const existingEmail = String((nodal as any).email || '').trim() || undefined;
  let empId = String((nodal as any).empId || '').trim();
  let userId = (nodal as any).userId
    ? String((nodal as any).userId)
    : '';
  let memberId = (nodal as any).memberId
    ? String((nodal as any).memberId)
    : '';

  const password = generatePassword(10);

  if (userId && !params.rotatePassword && memberId && empId) {
    throw new APIError({
      STATUS: 409,
      TITLE: 'NODAL_ALREADY_PROVISIONED',
      MESSAGE:
        'Nodal already has credentials. Use reset-password to rotate the password.',
    });
  }

  if (!empId) {
    empId = await generateEmpId(params.organizationId);
  }

  const syntheticEmail = `${empId.replace(/[^a-zA-Z0-9._-]/g, '_')}@nodal.local`;

  if (!userId) {
    // Server-side createUser: omit headers so admin middleware allows unauthenticated call.
    // Always use synthetic email so Google/social accounts are not collided with.
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

    // Ensure username + onboarding flags even if data merge was partial.
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
          role: 'nodal' as 'admin',
        },
      });
      memberId = String((member as any)?.id || '');
    } catch (err) {
      logger.error(`addMember failed for nodal=${params.nodalId}`, err);
      throw new APIError({
        STATUS: 500,
        TITLE: 'MEMBER_CREATE_FAILED',
        MESSAGE:
          err instanceof Error
            ? err.message
            : 'Failed to add nodal as organization member',
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
    // Existing user: ensure username + password rotation
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
            role: 'nodal' as 'admin',
          },
        });
        memberId = String((member as any)?.id || '');
      } catch (err) {
        // Already a member — look up member id
        const existing = await MemberModel.findOne({
          userId: new mongoose.Types.ObjectId(userId),
          organizationId: new mongoose.Types.ObjectId(params.organizationId),
        } as any)
          .select('_id')
          .lean();
        memberId = existing ? String((existing as any)._id) : '';
        if (!memberId) {
          throw err;
        }
      }
    }
  }

  await NodalModal.updateOne(
    { _id: params.nodalId },
    {
      $set: {
        empId,
        userId: new mongoose.Types.ObjectId(userId),
        memberId: new mongoose.Types.ObjectId(memberId),
      },
      $unset: { invitationId: 1 },
    }
  );

  // WhatsApp credential delivery disabled — Interakt campaign returns HTTP 401.
  // Credentials are delivered via admin UI / CSV download only.
  const whatsapp: NodalCredentialPayload['whatsapp'] = {
    ok: false,
    skipped: true,
    message: 'WhatsApp credential send disabled',
  };

  return {
    nodalId: String(params.nodalId),
    name,
    phone,
    email: existingEmail,
    empId,
    password,
    whatsapp,
  };
}

export async function resetNodalPassword(params: {
  nodalId: string;
  organizationId: string;
  skipWhatsApp?: boolean;
}): Promise<NodalCredentialPayload> {
  return provisionNodalCredentials({
    ...params,
    rotatePassword: true,
  });
}
