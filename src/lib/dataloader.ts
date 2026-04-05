import DataLoader from 'dataloader';
import { UserModel } from '@/modules/auth/users/users.model';
import { SessionModel } from '@/modules/auth/sessions/sessions.model';
import type { User } from '@/modules/auth/users/users.model';
import type { Session } from '@/modules/auth/sessions/sessions.model';

type LeanUser = Record<string, unknown> & { _id: unknown };
type LeanSession = Record<string, unknown> & { _id: unknown };

/**
 * Create a DataLoader that batches and caches by key.
 * Use one factory per request to avoid leaking cache across requests.
 */
export function createDataLoader<K, V>(
  batchFn: (keys: readonly K[]) => Promise<(V | Error)[]>,
  options?: { cache?: boolean }
): DataLoader<K, V> {
  return new DataLoader(batchFn, {
    cache: options?.cache ?? true,
  });
}

/**
 * Request-scoped loaders. Create once per request (e.g. in tRPC/GraphQL context) to avoid N+1 and share cache within the request.
 */
export interface RequestLoaders {
  userLoader: DataLoader<string, User | null>;
  sessionLoader: DataLoader<string, Session | null>;
}

function toUser(doc: LeanUser): User {
  const id = typeof doc._id === 'string' ? doc._id : String(doc._id);
  return {
    id,
    name: doc.name as string,
    email: doc.email as string,
    emailVerified: (doc.emailVerified as boolean) ?? false,
    image: (doc.image as string) ?? '',
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
    role: (doc.role as 'user' | 'admin') ?? 'user',
    banned: (doc.banned as boolean) ?? false,
    banReason: (doc.banReason as string) ?? '',
    banExpires: doc.banExpires as Date,
    isOnboarded: (doc.isOnboarded as boolean) ?? false,
  };
}

function toSession(doc: LeanSession): Session {
  const id = typeof doc._id === 'string' ? doc._id : String(doc._id);
  return {
    id,
    expiresAt: doc.expiresAt as Date,
    token: doc.token as string,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
    userId: doc.userId as string,
    ipAddress: doc.ipAddress as string | undefined,
    userAgent: doc.userAgent as string | undefined,
    impersonatedBy: doc.impersonatedBy as string | undefined,
    activeOrganizationId: doc.activeOrganizationId as string | undefined,
    activeOrganizationRole: doc.activeOrganizationRole as string | undefined,
  };
}

/**
 * Batch load users by id. Preserves order and returns null for missing ids.
 */
async function batchUsers(ids: readonly string[]): Promise<(User | null)[]> {
  const list = await UserModel.find({ _id: { $in: [...ids] } })
    .lean()
    .exec();
  const byId = new Map(
    list.map((u) => [String((u as LeanUser)._id), toUser(u as LeanUser)])
  );
  return ids.map((id) => byId.get(id) ?? null);
}

/**
 * Batch load sessions by id. Preserves order and returns null for missing ids.
 */
async function batchSessions(
  ids: readonly string[]
): Promise<(Session | null)[]> {
  const list = await SessionModel.find({ _id: { $in: [...ids] } })
    .lean()
    .exec();
  const byId = new Map(
    list.map((s) => [
      String((s as LeanSession)._id),
      toSession(s as LeanSession),
    ])
  );
  return ids.map((id) => byId.get(id) ?? null);
}

/**
 * Create request-scoped DataLoaders for users and sessions.
 * Call once per request and pass the result into tRPC/GraphQL context.
 */
export function createRequestLoaders(): RequestLoaders {
  return {
    userLoader: createDataLoader(batchUsers),
    sessionLoader: createDataLoader(batchSessions),
  };
}
