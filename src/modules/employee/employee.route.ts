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

router.post(
  '/sync-from-org-members',
  validateRequest({ body: z.object({ departmentId: z.string() }) }),
  EmployeeHandler.syncFromOrgMembers
);

router.post(
  '/:email/attach-user-id-and-member-id',
  validateRequest({
    params: z.object({ email: z.string() }),
    body: attachUserIdMemberIdZodSchema,
  }),
  EmployeeHandler.attachUserIdAndMemberId
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

// POST /api/v1/employee/send-invitation-to-rest-employees - Send invitation to rest employees
router.post(
  '/send-invitation-to-rest-employees',
  validateRequest({ body: z.object({ departmentId: z.string() }) }),
  EmployeeHandler.sendInvitationToRestEmployees
);

export default router;
