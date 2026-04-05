import z from 'zod';
import { validateRequest } from '@/middlewares/zod-validate-request';
import { KpiTemplateHandler } from './templates.handler';
import { zKpiTemplateCreate, zKpiTemplateUpdate } from './templates.model';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();

router.get('/', KpiTemplateHandler.getTemplates);
router.get(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  KpiTemplateHandler.getTemplate
);
router.post(
  '/',
  validateRequest({ body: zKpiTemplateCreate }),
  KpiTemplateHandler.createTemplate
);
router.put(
  '/:id',
  validateRequest({
    params: z.object({ id: z.string() }),
    body: zKpiTemplateUpdate,
  }),
  KpiTemplateHandler.updateTemplate
);
router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  KpiTemplateHandler.deleteTemplate
);

export default router;
