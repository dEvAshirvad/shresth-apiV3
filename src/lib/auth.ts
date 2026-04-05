import { betterAuth } from 'better-auth';
import { db } from '@/configs/db/mongodb';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import socialProviders from '@/lib/auth/socials';
import emailAndPassword from '@/lib/auth/password';
import { authDbHooks, authHooks } from '@/lib/auth/hooks';
import emailVerification from '@/lib/auth/emailVerification';
import allowedOrigins from '@/configs/origins';
import env from '@/configs/env';
import { openAPI, admin, organization } from 'better-auth/plugins';
import adminConfig from '@/lib/auth/adminConfig';
import organizationConfig from '@/lib/auth/organization';
import { user, session } from '@/lib/auth/schemas';

export const auth = betterAuth({
  database: mongodbAdapter(db),
  emailAndPassword,
  socialProviders,
  user,
  session,
  hooks: authHooks,
  databaseHooks: authDbHooks,
  emailVerification,
  plugins: [openAPI(), admin(adminConfig), organization(organizationConfig)],
  advanced: {
    cookiePrefix: 'finager_india',
    ...(env.NODE_ENV !== 'production' && {
      disableOriginCheck: true,
      disableCSRFCheck: true,
    }),
  },
  trustedOrigins: allowedOrigins,
});
