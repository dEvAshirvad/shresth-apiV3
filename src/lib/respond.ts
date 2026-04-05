import { Response, Request } from 'express';
import { Link, generatePaginationLinks } from '@/lib/hateoas';
import { PaginationResult } from '@/lib/paginator';

/** Human-readable time for API envelope; always UTC so it matches stored ISO dates (KPI dates are UTC calendar days). */
function formatTimestampUtc(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(d) + ' UTC'
  );
}

/**
 * Response options
 */
export interface RespondOptions {
  cache?: boolean;
  success?: boolean;
  links?: Link[];
  meta?: Record<string, unknown>;
  serialize?: boolean;
}

/**
 * Enhanced Respond function with HATEOAS, serialization, and pagination support
 */
export default function Respond(
  res: Response,
  data: unknown = {},
  status: number = 200,
  options: RespondOptions = {}
) {
  const {
    cache = false,
    success = true,
    links = [],
    meta = {},
    serialize = true,
  } = options;

  const timestamp = new Date();

  // Base response structure
  let response: Record<string, unknown> = {
    success,
    status,
    timestamp: formatTimestampUtc(timestamp),
    cache,
  };

  // Handle pagination results
  if (
    data &&
    typeof data === 'object' &&
    'pagination' in data &&
    'data' in data
  ) {
    const paginatedData = data as PaginationResult<unknown>;
    response.data = paginatedData.data;
    response.pagination = paginatedData.pagination;

    // Add pagination links if request is available
    if (res.req && links.length === 0) {
      const req = res.req as Request;
      const paginationLinks = generatePaginationLinks(
        req,
        paginatedData.pagination.page,
        paginatedData.pagination.totalPages,
        req.path
      );
      response._links = paginationLinks;
    }
  } else {
    // Regular data response
    response.data = serialize ? serializeData(data) : data;
  }

  // Add HATEOAS links
  if (links.length > 0) {
    response._links = links;
  }

  // Add metadata
  if (Object.keys(meta).length > 0) {
    response.meta = meta;
  }

  // Add request ID if available
  if (res.req && (res.req as Request).id) {
    response.requestId = (res.req as Request).id;
  }

  return res.status(status).json(response);
}

/**
 * Serialize data (simple implementation, can be enhanced)
 */
function serializeData(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => serializeItem(item));
  }
  return serializeItem(data);
}

/**
 * Serialize a single item
 */
function serializeItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') {
    return item;
  }

  // Remove Mongoose-specific fields
  const serialized = { ...item };
  delete (serialized as Record<string, unknown>).__v;
  const rawId = (serialized as Record<string, unknown>)._id;
  if ((serialized as Record<string, unknown>).id === undefined && rawId) {
    (serialized as Record<string, unknown>).id = String(rawId);
  }
  delete (serialized as Record<string, unknown>)._id;

  return serialized;
}

/**
 * Respond with HATEOAS links
 */
export function RespondWithLinks(
  res: Response,
  data: unknown,
  status: number,
  links: Link[],
  options: Omit<RespondOptions, 'links'> = {}
) {
  return Respond(res, data, status, { ...options, links });
}

/**
 * Respond with pagination
 */
export function RespondWithPagination<T>(
  res: Response,
  paginatedData: PaginationResult<T>,
  status: number = 200,
  options: Omit<RespondOptions, 'links'> = {}
) {
  return Respond(res, paginatedData, status, options);
}

/**
 * Respond with error (maintains backward compatibility)
 */
export function RespondError(
  res: Response,
  error: { title: string; message?: string; errors?: unknown },
  status: number = 500
) {
  return Respond(
    res,
    {
      title: error.title,
      message: error.message,
      errors: error.errors,
    },
    status,
    { success: false }
  );
}
