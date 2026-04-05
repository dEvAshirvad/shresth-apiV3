import { createRouter } from '@/configs/serverConfig';
import { createUploadMiddleware } from '@/configs/multer';
import { requireOrgOwnerOrAdmin } from '@/middlewares/requireOrgOwnerOrAdmin';
import { InvitationHandler } from './invitations.handler';

const router = createRouter();

router.get('/', requireOrgOwnerOrAdmin, InvitationHandler.listInvitations);

const { middleware: importMiddleware } = createUploadMiddleware({
  isTemporary: true,
  fileextacceptArr: ['csv', 'xlsx'],
  filePrefix: 'org-invitations-import',
});

router.get(
  '/import/template',
  requireOrgOwnerOrAdmin,
  InvitationHandler.importTemplate
);

router.post(
  '/import',
  requireOrgOwnerOrAdmin,
  importMiddleware.single('file'),
  InvitationHandler.importAdminInvitations
);

export default router;
