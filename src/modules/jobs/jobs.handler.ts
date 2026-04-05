import { Request, Response } from 'express';
import APIError from '@/configs/errors/APIError';
import env from '@/configs/env';
import Respond from '@/lib/respond';
import { paramStr } from '@/lib/param';
import { getKpiJobForOrg } from '@/jobs/kpiBackground.queue';
import { HttpErrorStatusCode } from '@/types/errors/errors.types';

export class KpiJobsHandler {
  /** Poll BullMQ job status for heavy KPI tasks (WhatsApp batch, nodal bulk actions). */
  static async getJob(req: Request, res: Response) {
    const organizationId = req.session?.activeOrganizationId;
    if (!organizationId) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_ORGANIZATION',
        MESSAGE: 'No active organization in session',
      });
    }

    if (env.BACKGROUND_JOBS_SYNC) {
      return Respond(
        res,
        {
          message:
            'Background job queue is disabled (BACKGROUND_JOBS_SYNC=true). Heavy work runs inline in the API; there is no queued job state.',
        },
        400
      );
    }

    const jobId = paramStr(req.params.jobId);

    try {
      const job = await getKpiJobForOrg(jobId, organizationId);
      if (!job) {
        throw new APIError({
          STATUS: 404,
          TITLE: 'JOB_NOT_FOUND',
          MESSAGE: 'Job not found or does not belong to the active organization',
        });
      }
      return Respond(res, { job, message: 'Job status' }, 200);
    } catch (err) {
      if (err instanceof APIError) throw err;
      throw new APIError({
        STATUS: HttpErrorStatusCode.SERVICE_UNAVAILABLE,
        TITLE: 'JOB_QUEUE_UNAVAILABLE',
        MESSAGE: 'Could not read job status. Ensure Redis is available.',
        META: { cause: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
