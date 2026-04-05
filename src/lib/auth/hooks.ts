import MembersServices from '@/modules/auth/members/members.services';
import { BetterAuthOptions } from 'better-auth';
export const authHooks: BetterAuthOptions['hooks'] = {};

export const authDbHooks: BetterAuthOptions['databaseHooks'] = {
  session: {
    create: {
      before: async (session) => {
        const member = await MembersServices.getInitialOrganizationId(
          session.userId
        );
        return {
          data: {
            ...session,
            ...(member?.organizationId
              ? {
                  activeOrganizationId: member.organizationId.toString(),
                  activeOrganizationRole: member.role,
                  memberId: member.id,
                }
              : {}), // If organization is not found, don't set activeOrganizationId
          },
        };
      },
    },
  },
};
