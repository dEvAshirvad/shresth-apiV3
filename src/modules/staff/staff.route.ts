import z from 'zod';
import { createRouter } from '@/configs/serverConfig';
import { validateRequest } from '@/middlewares/zod-validate-request';
import { StaffHandler } from './staff.handler';

const router = createRouter();

router.get('/me', StaffHandler.getMe);

router.get('/periods', StaffHandler.listPeriods);

router.get(
  '/periods/:periodId/summary',
  validateRequest({ params: z.object({ periodId: z.string().min(1) }) }),
  StaffHandler.getPeriodSummary
);

router.get(
  '/periods/:periodId/cohort',
  validateRequest({
    params: z.object({ periodId: z.string().min(1) }),
    query: z
      .object({
        topN: z.string().optional(),
        bottomN: z.string().optional(),
      })
      .optional(),
  }),
  StaffHandler.getPeriodCohort
);

export default router;
