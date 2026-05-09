import { Model, Types } from 'mongoose';

/* ─────────────────────────────
   TYPES
───────────────────────────── */

type QueryOptions<TFilter extends object = Record<string, unknown>> = {
  searchFields?: string[];
  defaultSort?: string;
  select?: string;
  skipFields?: string[];
  customFilter?: (query: BaseQuery & TFilter) => Record<string, unknown>;
};

export interface BaseQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export type PaginatedResult<T> = {
  data: (T & { id: string })[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

/* ─────────────────────────────
   MAIN FUNCTION
───────────────────────────── */

export async function buildQuery<
  TDocument extends { _id: Types.ObjectId | string },
  TFilter extends object = Record<string, unknown>,
>(
  model: Model<TDocument>,
  query: BaseQuery & TFilter,
  options: QueryOptions<TFilter> = {},
): Promise<PaginatedResult<TDocument>> {
  const {
    page = 1,
    limit = 10,
    search,
    sortBy = options.defaultSort ?? 'createdAt',
    sortOrder = 'desc',
  } = query;

  const skip = (page - 1) * limit;

  /* ─────────────────────────────
     EXCLUDED FIELDS
  ───────────────────────────── */

  const excludedFields = new Set([
    'page',
    'limit',
    'search',
    'sortBy',
    'sortOrder',
    ...(options.skipFields ?? []),
  ]);

  let mongoFilter: Record<string, unknown> = {};

  /* ─────────────────────────────
     BASE FILTERS
  ───────────────────────────── */

  for (const [key, value] of Object.entries(query)) {
    if (excludedFields.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;

    mongoFilter[key] = value;
  }

  /* ─────────────────────────────
     CUSTOM FILTER
  ───────────────────────────── */

  if (options.customFilter) {
    mongoFilter = {
      ...mongoFilter,
      ...options.customFilter(query),
    };
  }

  /* ─────────────────────────────
     SEARCH
  ───────────────────────────── */

  if (search && options.searchFields?.length) {
    mongoFilter.$or = options.searchFields.map((field) => ({
      [field]: {
        $regex: search,
        $options: 'i',
      },
    }));
  }

  /* ─────────────────────────────
     SORT
  ───────────────────────────── */

  const sort: Record<string, 1 | -1> = {
    [sortBy]: sortOrder === 'asc' ? 1 : -1,
  };

  /* ─────────────────────────────
     QUERY EXECUTION
  ───────────────────────────── */

  const [data, total] = await Promise.all([
    model
      .find(mongoFilter)
      .select(options.select ?? '')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean<TDocument[]>()
      .exec(),

    model.countDocuments(mongoFilter),
  ]);

  /* ─────────────────────────────
     RESPONSE
  ───────────────────────────── */
  console.log(data, 'datahhh');
  console.log(total, '98765');
  console.log(mongoFilter, 'mongoFilter');
  return {
    data: data.map((item) => ({
      ...item,
      id: item._id.toString(),
    })),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
