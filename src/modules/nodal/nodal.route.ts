import { NodalHandler } from './nodal.handler';
import { createUploadMiddleware } from '@/configs/multer';
import { validateRequest } from '@/middlewares/zod-validate-request';
import {
  attachUserIdMemberIdZodSchema,
  nodalDepartmentCreateZodSchema,
  nodalDepartmentUpdateZodSchema,
} from './nodal.model';
import z from 'zod';
import { createRouter } from '@/configs/serverConfig';

const router = createRouter();
const { middleware: importMiddleware } = createUploadMiddleware({
  isTemporary: true,
  fileextacceptArr: ['csv', 'xlsx'],
  filePrefix: 'nodals-import',
});

router.get('/', NodalHandler.getNodals);

router.get('/import/template', NodalHandler.importTemplate);

router.post(
  '/import',
  importMiddleware.single('file'),
  NodalHandler.importNodals
);

router.post('/sync-from-org-members', NodalHandler.syncFromOrgMembers);

router.post(
  '/send-invitation-to-rest-nodals',
  NodalHandler.sendInvitationToRestNodals
);

router.post(
  '/:email/attach-user-id-and-member-id',
  validateRequest({
    params: z.object({ email: z.string() }),
    body: attachUserIdMemberIdZodSchema,
  }),
  NodalHandler.attachUserIdAndMemberId
);

router.get('/am-i-assigned', NodalHandler.amIAssigned);

router.get('/:id', NodalHandler.getNodal);

router.post(
  '/',
  validateRequest({ body: nodalDepartmentCreateZodSchema }),
  NodalHandler.createNodal
);

router.put(
  '/:id',
  validateRequest({ body: nodalDepartmentUpdateZodSchema }),
  NodalHandler.updateNodal
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  NodalHandler.deleteNodal
);

export default router;
