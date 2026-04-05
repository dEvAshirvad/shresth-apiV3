import { BetterAuthOptions } from 'better-auth';
import emailTemplates from '@/configs/emailTemplates';

const emailVerification: BetterAuthOptions['emailVerification'] = {
  sendVerificationEmail: async ({ user, url, token }, request) => {
    const headers = new Headers(request?.headers);
    try {
      await emailTemplates.sendVerificationEmail(
        headers.get('origin') as string,
        user.email,
        {
          name: user.name,
          verificationLink: url,
          token,
          expiresIn: '1 hour',
        }
      );
    } catch (error) {
      throw error;
    }
  },
  sendOnSignUp: true,
  autoSignInAfterVerification: true,
  expiresIn: 3600, // 1 hour
};
export default emailVerification;
