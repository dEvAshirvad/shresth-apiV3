import APIError from '@/configs/errors/APIError';
import { OrganizationModel } from './organizations.model';
import { HttpErrorStatusCode } from '@/types/errors/errors.types';
import { SessionModel } from '../sessions/sessions.model';
import { MemberModel } from '../members/members.model';
import mongoose from 'mongoose';

export default class OrganizationsService {
  static async generateOrgCode(name: string, slug: string) {
    try {
      const prefix =
        name?.slice(0, 3).toUpperCase() ||
        slug?.slice(0, 3).toUpperCase() ||
        'ORG';

      // Try a few times to find a unique orgCode
      let orgCode: string | null = null;
      const maxAttempts = 10;

      for (let i = 0; i < maxAttempts; i++) {
        const candidate =
          prefix + Math.floor(1000 + Math.random() * 9000).toString();

        // Check uniqueness against existing organizations
        // eslint-disable-next-line no-await-in-loop
        const existing = await OrganizationModel.findOne({
          orgCode: candidate,
        });

        if (!existing) {
          orgCode = candidate;
          break;
        }
      }

      if (!orgCode) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.INTERNAL_SERVER,
          TITLE: 'Unable to generate unique organization code',
          MESSAGE: 'Unable to generate unique organization code',
        });
      }

      return orgCode;
    } catch (error) {
      throw error;
    }
  }

  static async setActiveOrganization({
    organizationId,
    userId,
    sessionId,
  }: {
    organizationId: string;
    userId?: string;
    sessionId?: string;
  }) {
    try {
      if (!organizationId) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.BAD_REQUEST,
          TITLE: 'Organization ID is required',
          MESSAGE: 'Organization ID is required',
        });
      }

      const member = await MemberModel.findOne({
        organizationId,
        userId,
      });

      if (!member) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.NOT_FOUND,
          TITLE: 'Member not found',
          MESSAGE: 'Member not found',
        });
      }

      const updatedSession = await SessionModel.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(sessionId) },
        {
          activeOrganizationId: member.organizationId,
          activeOrganizationRole: member.role,
          memberId: member.id,
        },
        { returnDocument: 'after' }
      ).lean();

      if (!updatedSession) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.INTERNAL_SERVER,
          TITLE: 'Failed to update session',
          MESSAGE: 'Failed to update session',
        });
      }

      return updatedSession;
    } catch (error) {
      throw error;
    }
  }
}
