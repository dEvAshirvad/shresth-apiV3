import z from 'zod';
import { validateRequest } from '@/middlewares/zod-validate-request';
import { KpiEntryHandler } from './entries.handler';
import { zKpiEntryBulkSubmitInput, zKpiEntryUpsertInput } from './entries.model';
import { createUploadMiddleware } from '@/configs/multer';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();
const { middleware: importMiddleware } = createUploadMiddleware({
  isTemporary: true,
  fileextacceptArr: ['csv', 'xlsx'],
  filePrefix: 'kpi-entries-import',
});

router.get(
  '/import/template',
  validateRequest({
    query: z.object({
      templateId: z.string().min(1),
      departmentId: z.string().min(1),
      format: z.enum(['csv', 'xlsx']).optional(),
    }),
  }),
  KpiEntryHandler.importTemplate
);
router.get(
  '/import/entries',
  validateRequest({
    query: z.object({
      templateId: z.string().min(1),
      departmentId: z.string().min(1),
      periodId: z.string().optional(),
      format: z.enum(['csv', 'xlsx']).optional(),
    }),
  }),
  KpiEntryHandler.exportEntriesImportFormat
);
router.post(
  '/import',
  validateRequest({
    query: z.object({
      templateId: z.string().min(1),
      departmentId: z.string().min(1),
      periodId: z.string().optional(),
    }),
  }),
  importMiddleware.single('file'),
  KpiEntryHandler.importEntries
);

router.get('/', KpiEntryHandler.getEntries);

router.post(
  '/bulk-submit',
  validateRequest({ body: zKpiEntryBulkSubmitInput }),
  KpiEntryHandler.bulkSubmit
);

router.get(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  KpiEntryHandler.getEntry
);

// Save/create draft entry (upsert by employee+period+template)
router.post(
  '/',
  validateRequest({ body: zKpiEntryUpsertInput }),
  KpiEntryHandler.upsertDraft
);

router.post(
  '/:id/submit',
  validateRequest({ params: z.object({ id: z.string() }) }),
  KpiEntryHandler.submit
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  KpiEntryHandler.deleteDraft
);

export default router;
