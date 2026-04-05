import { createRouter } from '@/configs/serverConfig';
import OrganizationsHandler from './organizations.handler';

const router = createRouter();

router.post('/generate-org-code', OrganizationsHandler.generateOrgCode);
router.post(
  '/set-active-organization',
  OrganizationsHandler.setActiveOrganization
);

export default router;
