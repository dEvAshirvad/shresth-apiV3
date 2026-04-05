import { Request, Response } from 'express';
import OrganizationsService from './organizations.service';
import Respond from '@/lib/respond';

export default class OrganizationsHandler {
  static async generateOrgCode(req: Request, res: Response) {
    try {
      const { name, slug } = req.body;
      const orgCode = await OrganizationsService.generateOrgCode(name, slug);
      return Respond(res, orgCode, 200);
    } catch (error) {
      throw error;
    }
  }

  static async setActiveOrganization(req: Request, res: Response) {
    try {
      const { organizationId } = req.body;
      const userId = req.user?.id;
      const sessionId = req.session?.id;
      const updatedSession = await OrganizationsService.setActiveOrganization({
        organizationId,
        userId,
        sessionId,
      });
      return Respond(res, updatedSession, 200);
    } catch (error) {
      throw error;
    }
  }
}
