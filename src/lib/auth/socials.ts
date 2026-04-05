import env from '@/configs/env';
import { BetterAuthOptions } from 'better-auth/types';

const socialProviders: BetterAuthOptions['socialProviders'] = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
  },
};

export default socialProviders;
