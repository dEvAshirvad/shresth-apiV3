import z from 'zod';
import { validateRequest } from '@/middlewares/zod-validate-request';
import { requireKpiOrgAdmin } from '@/middlewares/requireKpiOrgAdmin';
import { KpiReportHandler } from './reports.handler';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();

const zWhatsAppSendBody = z.object({
  dryRun: z.boolean().optional(),
  departmentId: z.string().optional(),
  delayMs: z.number().int().min(0).max(120000).optional(),
  resend: z.boolean().optional(),
});

router.get('/', KpiReportHandler.list);

router.get(
  '/:periodId/department-report-zip',
  requireKpiOrgAdmin,
  validateRequest({
    params: z.object({ periodId: z.string().min(1) }),
    query: z.object({ force: z.string().optional() }),
  }),
  KpiReportHandler.downloadDepartmentZip
);

router.post(
  '/:periodId/whatsapp/send',
  requireKpiOrgAdmin,
  validateRequest({
    params: z.object({ periodId: z.string().min(1) }),
    body: zWhatsAppSendBody,
  }),
  KpiReportHandler.sendWhatsAppPerformance
);

router.get(
  '/:periodId/whatsapp/sends',
  requireKpiOrgAdmin,
  validateRequest({
    params: z.object({ periodId: z.string().min(1) }),
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
      departmentId: z.string().optional(),
    }),
  }),
  KpiReportHandler.listWhatsAppSends
);

router.get(
  '/:periodId/summary',
  validateRequest({ params: z.object({ periodId: z.string() }) }),
  KpiReportHandler.getSummary
);

router.get(
  '/:periodId/department-roles',
  validateRequest({
    params: z.object({ periodId: z.string() }),
    query: z.object({ departmentId: z.string().optional() }),
  }),
  KpiReportHandler.departmentRoleStats
);

router.get(
  '/:periodId/ranking/:scope',
  validateRequest({
    params: z.object({ periodId: z.string(), scope: z.string() }),
    query: z.object({
      departmentId: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  }),
  KpiReportHandler.ranking
);

export default router;
