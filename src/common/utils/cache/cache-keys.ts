/**
 * Centralized cache-key factory.
 *
 * All keys live here so they can be referenced consistently across
 * CabinService, ReviewService, and ReviewStatsListener without magic strings.
 */
export const CabinCacheKeys = {
  /** Tracks all active list-cache keys for bulk invalidation */
  index: 'cabin-list-index',

  /** Per-cabin individual entry */
  one: (id: string) => `cabin:${id}`,

  /** Per-query list entry (stable serialization of the query object) */
  list: (query: object) => `cabin-list:${stableJson(query)}`,
} as const;

export const ReviewCacheKeys = {
  /** Tracks cabin-scoped review-list keys for bulk invalidation */
  cabinIndex: (cabinId: string) => `review-list-index:${cabinId}`,

  /** Per-cabin + per-query review list */
  cabinList: (cabinId: string, query: object) =>
    `review-list:${cabinId}:${stableJson(query)}`,

  /** Per-user + per-query review list */
  userList: (userId: string, query: object) =>
    `review-user:${userId}:${stableJson(query)}`,
} as const;

/* ── helpers ── */

/**
 * Produces a deterministic JSON string regardless of object key insertion
 * order. Used to build stable cache keys from query objects.
 */
function stableJson(obj: object): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
