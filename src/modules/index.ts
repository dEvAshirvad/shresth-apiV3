import { createRouter } from '@/configs/serverConfig';
import organizationsRouter from './auth/organizations/organizations.router';
import invitationsRouter from './auth/invitations/invitations.route';
import onboardingRouter from './auth/onboarding/onboarding.router';
import departmentsRouter from './departments/departments.route';
import employeeRouter from './employee/employee.route';
import nodalRouter from './nodal/nodal.route';
import entriesRouter from './entries/entries.route';
import periodsRouter from './periods/periods.route';
import reportsRouter from './reports/reports.route';
import templatesRouter from './templates/templates.route';
import jobsRouter from './jobs/jobs.route';

const router = createRouter();

router.use('/organization/invitations', invitationsRouter);
router.use('/organization', organizationsRouter);
router.use('/onboarding', onboardingRouter);
router.use('/departments', departmentsRouter);
router.use('/employee', employeeRouter);
router.use('/nodal', nodalRouter);
router.use('/entries', entriesRouter);
router.use('/periods', periodsRouter);
router.use('/reports', reportsRouter);
router.use('/templates', templatesRouter);
router.use('/jobs', jobsRouter);

export default router;
