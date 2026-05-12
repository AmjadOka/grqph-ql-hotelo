// common/listeners/review-stats.listener.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { ReviewEvents } from '../../notification/events/review.event';
import { CabinCacheKeys } from 'src/common/utils/cache/cache-keys';
import { ReviewChangedEvent } from '../../notification/events/review-changed.event';
import { CabinStatsService } from '../services/cabin-stats.service';

@Injectable()
export class ReviewStatsListener {
  private readonly logger = new Logger(ReviewStatsListener.name);

  constructor(
    private readonly cabinStatsService: CabinStatsService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  @OnEvent(ReviewEvents.CHANGED, { async: true })
  async handleReviewChanged(event: ReviewChangedEvent): Promise<void> {
    const { cabinId } = event;
    console.log(event);
    try {
      const stats = await this.cabinStatsService.recompute(cabinId);

      await this.bustCaches(cabinId);

      this.logger.log(
        `[review.changed] cabin=${cabinId} → avg=${stats.ratingAvg} count=${stats.ratingCount}`,
      );
    } catch (err) {
      this.logger.error(`[review.changed] Failed for cabin=${cabinId}`, err);
    }
  }

  /* ───────────────────────────────────────────────────── */

  private async bustCaches(cabinId: string): Promise<void> {
    // a) individual cabin
    await this.cache.del(CabinCacheKeys.one(cabinId));

    // b) cabin list caches
    const listIndex =
      (await this.cache.get<string[]>(CabinCacheKeys.index)) ?? [];

    await Promise.all(listIndex.map((k) => this.cache.del(k)));
    await this.cache.del(CabinCacheKeys.index);

    // c) review list caches
    const reviewIndex =
      (await this.cache.get<string[]>(reviewListIndexKey(cabinId))) ?? [];

    await Promise.all(reviewIndex.map((k) => this.cache.del(k)));
    await this.cache.del(reviewListIndexKey(cabinId));
  }
}

/** shared helper */
export function reviewListIndexKey(cabinId: string): string {
  return `review-list-index:${cabinId}`;
}
