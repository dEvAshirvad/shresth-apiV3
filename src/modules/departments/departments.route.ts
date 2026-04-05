import { DepartmentHandler } from './departments.handler';
import { createUploadMiddleware } from '@/configs/multer';
import { validateRequest } from '@/middlewares/zod-validate-request';
import {
  zDepartmentAssignNodal,
  zDepartmentCreate,
  zDepartmentGet,
  zDepartmentUpdate,
} from './departments.model';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();
const { middleware: importMiddleware } = createUploadMiddleware({
  isTemporary: true,
  fileextacceptArr: ['csv', 'xlsx'],
  filePrefix: 'departments-import',
});

// GET /api/v1/departments - Get all departments with pagination and search
router.get(
  '/',
  validateRequest({ query: zDepartmentGet }),
  DepartmentHandler.getDepartments
);

// GET /api/v1/departments/import/template - Download import template
router.get('/import/template', DepartmentHandler.importTemplate);

// POST /api/v1/departments/import - Import departments from CSV/XLSX
router.post(
  '/import',
  importMiddleware.single('file'),
  DepartmentHandler.importDepartments
);

// GET /api/v1/departments/organization/statistics — must be before /:id
router.get(
  '/organization/statistics',
  DepartmentHandler.getOrganizationDepartmentStatistics
);

// GET /api/v1/departments/:id - Get a specific department
router.get('/:id', DepartmentHandler.getDepartment);

// POST /api/v1/departments - Create a new department
router.post(
  '/',
  validateRequest({ body: zDepartmentCreate }),
  DepartmentHandler.createDepartment
);

// PUT /api/v1/departments/:id - Update a department
router.put(
  '/:id',
  validateRequest({ body: zDepartmentUpdate }),
  DepartmentHandler.updateDepartment
);

router.patch(
  '/:id',
  validateRequest({
    body: zDepartmentAssignNodal,
  }),
  DepartmentHandler.assignNodal
);

// DELETE /api/v1/departments/:id - Delete a department
router.delete('/:id', DepartmentHandler.deleteDepartment);

export default router;
