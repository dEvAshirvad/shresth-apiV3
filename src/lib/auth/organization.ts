import { OrganizationOptions } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import {
  defaultStatements,
  ownerAc,
  adminAc,
  memberAc,
} from 'better-auth/plugins/organization/access';
import { UserModel } from '@/modules/auth/users/users.model';
import emailTemplates from '@/configs/emailTemplates';
import { NodalService } from '@/modules/nodal/nodal.services';
import { EmployeeService } from '@/modules/employee/employee.services';

const organisationStatements = {};

export const statement = {
  ...defaultStatements,
  ...organisationStatements,
} as const;

const ac = createAccessControl(statement);
const owner = ac.newRole({
  ...ownerAc.statements,
  ...organisationStatements,
});

const admin = ac.newRole({
  ...adminAc.statements,
  ...organisationStatements,
});

const nodal = ac.newRole({
  ...adminAc.statements,
  ...organisationStatements,
});

const staff = ac.newRole({
  ...memberAc.statements,
});

const organisation: OrganizationOptions = {
  requireEmailVerificationOnInvitation: true,
  async sendInvitationEmail(data, request) {
    // Generate invite link based on user present in our system or not
    const isUserPresent = await UserModel.findOne({ email: data.email });
    let inviteLink = '';
    const headers = new Headers(request?.headers);
    if (isUserPresent) {
      inviteLink = `${headers.get('origin')}/auth/organization/invitation/${data.id}`;
    } else {
      inviteLink = `${headers.get('origin')}`; // headers.get('origin') is the origin of the request
    }
    emailTemplates.sendOrganizationInvitationEmail(data.email, {
      invitedByUsername: data.inviter.user.name,
      invitedByEmail: data.inviter.user.email,
      teamName: data.organization.name,
      inviteLink,
    });
  },
  schema: {
    organization: {
      additionalFields: {
        orgCode: {
          type: 'string',
          unique: true,
        },
      },
    },
  },
  ac,
  roles: {
    admin,
    owner,
    nodal,
    staff,
  },
  creatorRole: 'owner',
  organizationHooks: {
    beforeCreateOrganization: async ({ organization, user }) => {
      try {
      } catch (error) {}
    },

    afterCreateOrganization: async ({ organization, user }) => {
      try {
      } catch (error) {}
    },

    afterAcceptInvitation: async ({ member, user, organization }) => {
      try {
        if (member.role === 'nodal') {
          await NodalService.attachUserIdAndMemberId(member.email, {
            userId: user.id,
            memberId: member.id,
          });
        }
        if (member.role === 'staff') {
          await EmployeeService.attachUserIdAndMemberId(member.email, {
            userId: user.id,
            memberId: member.id,
          });
        }
      } catch (error) {}
    },
  },
};

export default organisation;
