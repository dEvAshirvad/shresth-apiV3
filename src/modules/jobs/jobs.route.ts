import z from 'zod';
import { validateRequest } from '@/middlewares/zod-validate-request';
import { requireKpiOrgAdmin } from '@/middlewares/requireKpiOrgAdmin';
import { createRouter } from '@/configs/serverConfig';
import { KpiJobsHandler } from './jobs.handler';

const router = createRouter();

router.get(
  '/:jobId',
  requireKpiOrgAdmin,
  validateRequest({ params: z.object({ jobId: z.string().min(1) }) }),
  KpiJobsHandler.getJob
);

export default router;
