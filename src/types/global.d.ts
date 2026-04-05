/** User/Session: auth model types as single source of truth (req.user, req.session, tRPC ctx). */
import type { User } from '@/modules/auth/users/users.model';
import type { Session } from '@/modules/auth/sessions/sessions.model';

export type { User, Session };

declare global {
  namespace Express {
    interface Request {
      id: string;
      session?: Session;
      user?: User;
    }
  }
}
export interface QueryOptions {
  page: number;
  limit: number;
  sort?: string;
}

export interface PaginatedResult<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  totalPages: number;
  page: number;
  nextPage: boolean;
  prevPage: boolean;
}
