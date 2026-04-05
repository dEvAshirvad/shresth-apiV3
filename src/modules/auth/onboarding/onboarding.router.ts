import { createRouter } from '@/configs/serverConfig';
import OnboardingHandler from './onboarding.handler';
const router = createRouter();

router.post('/complete-onboarding', OnboardingHandler.completeOnboarding);

export default router;
