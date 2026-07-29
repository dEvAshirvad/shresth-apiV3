import { EmployeeHandler } from './employee.handler';
import { createUploadMiddleware } from '@/configs/multer';
import { validateRequest } from '@/middlewares/zod-validate-request';
import {
  attachUserIdMemberIdZodSchema,
  employeeDepartmentCreateZodSchema,
  employeeDepartmentUpdateZodSchema,
} from './employee.model';
import z from 'zod';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();
const { middleware: importMiddleware } = createUploadMiddleware({
  isTemporary: true,
  fileextacceptArr: ['csv', 'xlsx'],
  filePrefix: 'employees-import',
});

// GET /api/v1/employee - Get all employees with pagination and search
router.get('/', EmployeeHandler.getEmployees);

// GET /api/v1/employee/import/template - Download import template
router.get('/import/template', EmployeeHandler.importTemplate);

// POST /api/v1/employee/import - Import employees from CSV/XLSX
// Multer must run before Zod: multipart fields live in req.body only after parse.
router.post(
  '/import',
  importMiddleware.single('file'),
  validateRequest({ body: z.object({ departmentId: z.string() }) }),
  EmployeeHandler.importEmployees
);

/** @deprecated Prefer provision-credentials for new staff pseudo-users. */
router.post(
  '/sync-from-org-members',
  validateRequest({ body: z.object({ departmentId: z.string() }) }),
  EmployeeHandler.syncFromOrgMembers
);

/** Prefer over send-invitation: auto empId + password (CSV/UI only). */
router.post(
  '/provision-credentials',
  validateRequest({
    body: z.object({ departmentId: z.string().optional() }).optional(),
  }),
  EmployeeHandler.provisionCredentials
);

/** One-shot: rotate/provision employees; optional ?departmentId; ?format=csv. */
router.post(
  '/download-all-credentials',
  EmployeeHandler.downloadAllCredentials
);

/** @deprecated Prefer provision-credentials. */
router.post(
  '/send-invitation-to-rest-employees',
  validateRequest({ body: z.object({ departmentId: z.string() }) }),
  EmployeeHandler.sendInvitationToRestEmployees
);

router.post(
  '/:email/attach-user-id-and-member-id',
  validateRequest({
    params: z.object({ email: z.string() }),
    body: attachUserIdMemberIdZodSchema,
  }),
  EmployeeHandler.attachUserIdAndMemberId
);

router.post(
  '/:id/reset-password',
  validateRequest({ params: z.object({ id: z.string() }) }),
  EmployeeHandler.resetPassword
);

// GET /api/v1/employee/:id - Get a specific employee
router.get('/:id', EmployeeHandler.getEmployee);

// POST /api/v1/employee - Create a new employee
router.post(
  '/',
  validateRequest({ body: employeeDepartmentCreateZodSchema }),
  EmployeeHandler.createEmployee
);

// PUT /api/v1/employee/:id - Update an employee
router.put(
  '/:id',
  validateRequest({ body: employeeDepartmentUpdateZodSchema }),
  EmployeeHandler.updateEmployee
);

// DELETE /api/v1/employee/:id - Delete an employee
router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  EmployeeHandler.deleteEmployee
);

export default router;
