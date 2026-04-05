import { auth } from '@/lib/auth';
import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { User } from '@/modules/auth/users/users.model';
import { Session } from '@/modules/auth/sessions/sessions.model';

export default async function sessions(
  req: Request,
  _: Response,
  next: NextFunction
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  req.user = session?.user as User;
  req.session = session?.session as Session;
  next();
}
