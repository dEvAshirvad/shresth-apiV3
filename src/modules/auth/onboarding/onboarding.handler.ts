import { Request, Response } from 'express';
import Respond from '@/lib/respond';
import { UserModel } from '../users/users.model';
import { MemberModel } from '../members/members.model';
import APIError from '@/configs/errors/APIError';
import { HttpErrorStatusCode } from '@/types/errors/errors.types';

export default class OnboardingHandler {
  static async completeOnboarding(req: Request, res: Response) {
    try {
      const user = req.user;
      // Check if user is onboarded
      if (user?.isOnboarded) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.BAD_REQUEST,
          TITLE: 'User is already onboarded',
          MESSAGE: 'User is already onboarded',
        });
      }

      const isMember = await MemberModel.findOne({
        userId: user?.id,
      });

      if (!isMember) {
        throw new APIError({
          STATUS: HttpErrorStatusCode.NOT_FOUND,
          TITLE: 'Member not found',
          MESSAGE: 'Member not found',
        });
      }

      await UserModel.findByIdAndUpdate(user?.id, { isOnboarded: true });
      return Respond(
        res,
        { message: 'Onboarding completed successfully' },
        200
      );
    } catch (error) {
      throw error;
    }
  }
}
