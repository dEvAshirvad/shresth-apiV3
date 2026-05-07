import z from 'zod';
import { createRouter } from '@/configs/serverConfig';
import { validateRequest } from '@/middlewares/zod-validate-request';
import { requireKpiOrgAdmin } from '@/middlewares/requireKpiOrgAdmin';
import { PdfHandler } from './pdf.handler';

const router = createRouter();

router.use(requireKpiOrgAdmin);

router.get(
  '/zip/:periodId',
  validateRequest({
    params: z.object({ periodId: z.string().min(1) }),
    query: z.object({ force: z.string().optional(), organizationId: z.string().optional() }),
  }),
  PdfHandler.getAllDepartmentsZip
);

router.get(
  '/:departmentId',
  validateRequest({
    params: z.object({ departmentId: z.string().min(1) }),
    query: z.object({ periodId: z.string().optional(), organizationId: z.string().optional() }),
  }),
  PdfHandler.getDepartmentPdf
);

router.get(
  '/:departmentId/meta',
  validateRequest({
    params: z.object({ departmentId: z.string().min(1) }),
    query: z.object({ periodId: z.string().optional(), organizationId: z.string().optional() }),
  }),
  PdfHandler.getDepartmentPdfMeta
);

export default router;
