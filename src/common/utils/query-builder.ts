/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
type QueryOptions<T extends object = Record<string, unknown>> = {
  searchFields?: string[];
  defaultSort?: string;
  select?: string;
  skipFields?: string[];
  customFilter?: (query: BaseQuery & T) => Record<string, unknown>;
};

export interface BaseQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function buildQuery<TFilter extends object>(
  model: any,
  query: BaseQuery & TFilter,
  options: QueryOptions<TFilter> = {},
) {
  const {
    page = 1,
    limit = 10,
    search,
    sortBy = options.defaultSort ?? 'createdAt',
    sortOrder = 'desc',
  } = query;

  const skip = (page - 1) * limit;

  // ─────────────────────────────
  // Fields ignored from raw equality filters
  // ─────────────────────────────
  const excludedFields = new Set([
    'page',
    'limit',
    'search',
    'sortBy',
    'sortOrder',
    ...(options.skipFields ?? []),
  ]);

  let mongoFilter: Record<string, unknown> = {};

  // ─────────────────────────────
  // 1. Base equality filters
  // ─────────────────────────────
  for (const [key, value] of Object.entries(query)) {
    if (excludedFields.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;

    mongoFilter[key] = value;
  }

  // ─────────────────────────────
  // 2. Custom filters
  // ─────────────────────────────
  if (options.customFilter) {
    mongoFilter = {
      ...mongoFilter,
      ...options.customFilter(query),
    };
  }

  // ─────────────────────────────
  // 3. Search
  // ─────────────────────────────
  if (search && options.searchFields?.length) {
    mongoFilter.$or = options.searchFields.map((field) => ({
      [field]: {
        $regex: search,
        $options: 'i',
      },
    }));
  }

  // ─────────────────────────────
  // 4. Sort
  // ─────────────────────────────
  const sort: Record<string, 1 | -1> = {
    [sortBy]: sortOrder === 'asc' ? 1 : -1,
  };
  console.log(query);
  console.log(mongoFilter, sort, skip, limit);
  // ─────────────────────────────
  // 5. Execute
  // ─────────────────────────────
  const [data, total] = await Promise.all([
    model
      .find(mongoFilter)
      .select(options.select ?? '')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),

    model.countDocuments(mongoFilter),
  ]);

  // ─────────────────────────────
  // 6. Response
  // ─────────────────────────────
  return {
    data: data.map((item: any) => ({
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
