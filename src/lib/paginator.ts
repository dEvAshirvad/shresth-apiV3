import { Request } from 'express';

/**
 * Pagination query parameters
 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * Pagination result interface
 */
export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Default pagination values
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Parse pagination query from request
 */
export const parsePagination = (req: Request): PaginationQuery => {
  const page = Math.max(1, parseInt(req.query.page as string) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(req.query.limit as string) || DEFAULT_LIMIT)
  );
  const sort = (req.query.sort as string) || undefined;
  const order = (req.query.order as 'asc' | 'desc') === 'desc' ? 'desc' : 'asc';

  return { page, limit, sort, order };
};

/**
 * Create pagination result
 */
export const createPaginationResult = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginationResult<T> => {
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

/**
 * Create MongoDB sort object from pagination query
 */
export const createSortObject = (
  sort?: string,
  order: 'asc' | 'desc' = 'asc'
): Record<string, 1 | -1> => {
  if (!sort) return { createdAt: -1 }; // Default sort by createdAt desc

  const sortFields = sort.split(',').reduce(
    (acc, field) => {
      const trimmed = field.trim();
      if (trimmed.startsWith('-')) {
        acc[trimmed.substring(1)] = -1;
      } else {
        acc[trimmed] = order === 'asc' ? 1 : -1;
      }
      return acc;
    },
    {} as Record<string, 1 | -1>
  );

  return sortFields;
};

/**
 * Calculate skip value for MongoDB queries
 */
export const calculateSkip = (page: number, limit: number): number => {
  return (page - 1) * limit;
};

/**
 * Pagination helper for Mongoose queries
 */
export class PaginationHelper {
  /**
   * Paginate a Mongoose query
   */
  static async paginate<T>(
    query: any,
    page: number,
    limit: number
  ): Promise<PaginationResult<T>> {
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      query.skip(skip).limit(limit).exec(),
      query.model.countDocuments(query.getQuery()).exec(),
    ]);

    return createPaginationResult(data, total, page, limit);
  }

  /**
   * Paginate with aggregation pipeline
   */
  static async paginateAggregate<T>(
    pipeline: any[],
    page: number,
    limit: number,
    model: any
  ): Promise<PaginationResult<T>> {
    const skip = calculateSkip(page, limit);

    // Add pagination to pipeline
    const paginatedPipeline = [
      ...pipeline,
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await model.aggregate(paginatedPipeline);
    const total = result?.total[0]?.count || 0;

    return createPaginationResult(result.data, total, page, limit);
  }
}
