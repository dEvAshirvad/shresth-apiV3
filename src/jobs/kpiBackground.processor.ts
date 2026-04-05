import type { Job } from 'bullmq';
import type { User } from '@/modules/auth/users/users.model';
import { UserModel } from '@/modules/auth/users/users.model';
import { NodalService } from '@/modules/nodal/nodal.services';
import { WhatsappPerformanceService } from '@/modules/reports/whatsappPerformance.service';
import { KPI_BACKGROUND_JOB, type WhatsAppSendJobData } from './kpiBackground.jobData';

export async function processKpiBackgroundJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case KPI_BACKGROUND_JOB.WHATSAPP_SEND:
      return WhatsappPerformanceService.sendPerformanceBatch(
        job.data as WhatsAppSendJobData
      );
    case KPI_BACKGROUND_JOB.NODAL_SYNC_MEMBERS: {
      const { organizationId } = job.data as { organizationId: string };
      return NodalService.syncUserAndMemberFromEmails(organizationId);
    }
    case KPI_BACKGROUND_JOB.NODAL_SEND_INVITATIONS: {
      const { organizationId, triggeredByUserId, origin } = job.data as {
        organizationId: string;
        triggeredByUserId: string;
        origin?: string;
      };
      const userDoc = await UserModel.findById(triggeredByUserId).lean();
      if (!userDoc) {
        throw new Error('INVITER_USER_NOT_FOUND');
      }
      const user = {
        id: String((userDoc as { _id: unknown })._id),
        email: (userDoc as { email?: string }).email,
        name: (userDoc as { name?: string }).name,
      } as unknown as User;
      return NodalService.sendInvitationToRestNodals(organizationId, user, origin);
    }
    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
}
