import { validateRequest } from '@/middlewares/zod-validate-request';
import { requireKpiOrgAdmin } from '@/middlewares/requireKpiOrgAdmin';
import { KpiPeriodHandler } from './periods.handler';
import {
  zKpiPeriodConfigPutBody,
  zPeriodAdminGenerateReportsBody,
  zPeriodAdminForceLockBody,
  zPeriodAdminUpdateEndDateBody,
  zPeriodAdminUpdatePeriodDatesBody,
  zPeriodIdParams,
  zPeriodListQuery,
} from './periods.model';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();

router.get(
  '/',
  validateRequest({ query: zPeriodListQuery }),
  KpiPeriodHandler.listPeriods
);
router.get('/config', KpiPeriodHandler.getConfig);
router.get(
  '/:id',
  validateRequest({ params: zPeriodIdParams }),
  KpiPeriodHandler.getPeriod
);

// Start once: bootstraps first period from configured anchor (startDate)
router.post('/start', KpiPeriodHandler.start);

// Update period configuration (generation remains automatic)
router.put(
  '/config',
  validateRequest({ body: zKpiPeriodConfigPutBody }),
  KpiPeriodHandler.updateConfig
);

// Org admins only (owner / admin / nodal): operational overrides
router.post(
  '/admin/force-lock',
  requireKpiOrgAdmin,
  validateRequest({ body: zPeriodAdminForceLockBody }),
  KpiPeriodHandler.adminForceLock
);
router.post(
  '/admin/update-end-date',
  requireKpiOrgAdmin,
  validateRequest({ body: zPeriodAdminUpdateEndDateBody }),
  KpiPeriodHandler.adminUpdateEndDate
);
router.post(
  '/admin/update-period-dates',
  requireKpiOrgAdmin,
  validateRequest({ body: zPeriodAdminUpdatePeriodDatesBody }),
  KpiPeriodHandler.adminUpdatePeriodDates
);
router.post(
  '/admin/generate-reports',
  requireKpiOrgAdmin,
  validateRequest({ body: zPeriodAdminGenerateReportsBody }),
  KpiPeriodHandler.adminGenerateReports
);

export default router;
