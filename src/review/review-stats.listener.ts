import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Review } from './review.schema';
import { Cabin } from '../cabin/cabin.schema';
import { ReviewEvents } from './review.event';
import { CabinCacheKeys } from '../common/utils/cache/cache-keys';

export interface ReviewChangedPayload {
  cabinId: string;
}

@Injectable()
export class ReviewStatsListener {
  private readonly logger = new Logger(ReviewStatsListener.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<Review>,
    @InjectModel(Cabin.name) private cabinModel: Model<Cabin>,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  /**
   * Recomputes ratingAvg + ratingCount for the given cabin using
   * MongoDB aggregation, then writes them atomically to the Cabin document.
   *
   * Also invalidates:
   *  - Individual cabin cache (CabinCacheKeys.one)
   *  - All cabin-list caches (tracked index)
   *  - All review-list caches for this cabin (review-list:{cabinId}:*)
   */
  @OnEvent(ReviewEvents.CHANGED, { async: true })
  async handleReviewChanged(payload: ReviewChangedPayload): Promise<void> {
    const { cabinId } = payload;

    try {
      // FIX: $match now uses correct field name 'cabinId' with a proper
      // ObjectId conversion — no more fragile type-sniffing logic
      const [stats] = await this.reviewModel.aggregate<{
        avgRating: number;
        count: number;
      }>([
        {
          $match: {
            cabinId: new Types.ObjectId(cabinId),
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ]);

      const ratingAvg = stats
        ? Math.round((stats.avgRating ?? 0) * 10) / 10
        : 0;
      const ratingCount = stats?.count ?? 0;

      /* ── 2. Persist to Cabin document ── */
      await this.cabinModel.findByIdAndUpdate(cabinId, {
        ratingAvg,
        ratingCount,
      });

      this.logger.log(
        `[review.changed] cabin=${cabinId} → avg=${ratingAvg} count=${ratingCount}`,
      );

      /* ── 3. Bust caches ── */
      await this.bustCaches(cabinId);
    } catch (err) {
      this.logger.error(
        `[review.changed] Failed to update stats for cabin=${cabinId}`,
        err,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE
  ───────────────────────────────────────────────────── */

  private async bustCaches(cabinId: string): Promise<void> {
    // a) individual cabin entry
    await this.cache.del(CabinCacheKeys.one(cabinId));

    // b) all tracked cabin-list entries
    const listIndex =
      (await this.cache.get<string[]>(CabinCacheKeys.index)) ?? [];
    await Promise.all(listIndex.map((k) => this.cache.del(k)));
    await this.cache.del(CabinCacheKeys.index);

    // c) all review-list entries for this cabin
    const reviewIndex =
      (await this.cache.get<string[]>(reviewListIndexKey(cabinId))) ?? [];
    await Promise.all(reviewIndex.map((k) => this.cache.del(k)));
    await this.cache.del(reviewListIndexKey(cabinId));
  }
}

/** Shared helper — also used in ReviewService to register keys */
export function reviewListIndexKey(cabinId: string): string {
  return `review-list-index:${cabinId}`;
}
