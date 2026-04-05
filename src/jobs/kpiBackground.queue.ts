import { Queue } from 'bullmq';
import env from '@/configs/env';

/** Included in **202** responses when work is queued — without a worker, jobs never run (no emails, etc.). */
export const KPI_QUEUED_JOB_HINT =
  'Queued jobs are handled by a separate process: run `pnpm worker:dev` alongside the API, or set BACKGROUND_JOBS_SYNC=true to run work in the API (slower requests). Poll GET /api/v1/jobs/:jobId.';
import { createBullConnection } from './bullmqConnection';
import {
  KPI_BACKGROUND_JOB,
  type NodalSendInvitationsJobData,
  type NodalSyncMembersJobData,
  type WhatsAppSendJobData,
} from './kpiBackground.jobData';

const QUEUE_NAME = 'kpi-background';
const PREFIX = 'kpi';

const defaultJobOpts = {
  attempts: 1,
  removeOnComplete: { age: 86_400, count: 2000 } as const,
  removeOnFail: { age: 604_800, count: 500 } as const,
};

let queueSingleton: Queue | null = null;

export function getKpiBackgroundQueue(): Queue {
  if (env.BACKGROUND_JOBS_SYNC) {
    throw new Error('Background queue is disabled when BACKGROUND_JOBS_SYNC=true');
  }
  if (!queueSingleton) {
    queueSingleton = new Queue(QUEUE_NAME, {
      connection: createBullConnection(),
      prefix: PREFIX,
    });
  }
  return queueSingleton;
}

export async function enqueueWhatsAppSend(payload: WhatsAppSendJobData) {
  const queue = getKpiBackgroundQueue();
  const job = await queue.add(KPI_BACKGROUND_JOB.WHATSAPP_SEND, payload, {
    ...defaultJobOpts,
  });
  return { jobId: String(job.id) };
}

export async function enqueueNodalSyncMembers(payload: NodalSyncMembersJobData) {
  const queue = getKpiBackgroundQueue();
  const job = await queue.add(KPI_BACKGROUND_JOB.NODAL_SYNC_MEMBERS, payload, {
    ...defaultJobOpts,
  });
  return { jobId: String(job.id) };
}

export async function enqueueNodalSendInvitations(payload: NodalSendInvitationsJobData) {
  const queue = getKpiBackgroundQueue();
  const job = await queue.add(KPI_BACKGROUND_JOB.NODAL_SEND_INVITATIONS, payload, {
    ...defaultJobOpts,
  });
  return { jobId: String(job.id) };
}

export async function getKpiJobForOrg(jobId: string, organizationId: string) {
  const queue = getKpiBackgroundQueue();
  const job = await queue.getJob(jobId);
  if (!job) return null;
  const data = job.data as { organizationId?: string };
  if (String(data.organizationId) !== String(organizationId)) {
    return null;
  }
  const state = await job.getState();
  return {
    jobId: String(job.id),
    name: job.name,
    state,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    progress: job.progress,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
}
