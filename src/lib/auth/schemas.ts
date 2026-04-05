import { BetterAuthOptions } from 'better-auth/types';

const user: BetterAuthOptions['user'] = {
  additionalFields: {
    isOnboarded: {
      type: 'boolean',
      input: false,
      defaultValue: false,
    },
  },
};

const session: BetterAuthOptions['session'] = {
  additionalFields: {
    activeOrganizationRole: {
      type: 'string',
      input: false,
    },
  },
};

export { user, session };
