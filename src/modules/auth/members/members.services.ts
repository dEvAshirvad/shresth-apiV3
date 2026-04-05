import { Member, MemberModel } from './members.model';

export default class MembersServices {
  static async getInitialOrganizationId(
    userId: string
  ): Promise<Member | undefined> {
    const member = await MemberModel.findOne({ userId });
    return member?.toObject() as Member | undefined;
  }
}
