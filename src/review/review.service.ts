import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Review } from './review.schema';
import { Cabin } from '../cabin/cabin.schema';
import { buildQuery, BaseQuery } from 'src/common/utils/query-builder';
import { UserRole } from 'src/user/user.schema';
import { AuthUser } from './review.resolver';
import { UpdateReviewInput } from './dto/update-review.input';
import { CreateReviewInput } from './dto/create-review.input';
import { ReviewEvents } from './review.event';
import { reviewListIndexKey } from './review-stats.listener';
import { ReviewQueryInput } from './dto/review-query.input';

/** Cache TTL for review lists (seconds) */
const REVIEW_CACHE_TTL = 60;

// review-response.dto.ts — export the inner type too
export interface ReviewPaginatedResult {
  data: Review[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<Review>,
    @InjectModel(Cabin.name) private cabinModel: Model<Cabin>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  /* =====================================================
     PRIVATE — CACHE HELPERS
  ===================================================== */

  private reviewCacheKey(cabinId: string, query: BaseQuery): string {
    return `review-list:${cabinId}:${JSON.stringify(query)}`;
  }

  private userReviewCacheKey(userId: string, query: BaseQuery): string {
    return `review-user:${userId}:${JSON.stringify(query)}`;
  }

  /**
   * Registers a cabin-scoped list key so the listener can bulk-invalidate
   * all cached variants when reviews change for that cabin.
   */
  private async trackCabinListKey(cabinId: string, key: string): Promise<void> {
    const indexKey = reviewListIndexKey(cabinId);
    const index = (await this.cache.get<string[]>(indexKey)) ?? [];
    if (!index.includes(key)) {
      await this.cache.set(indexKey, [...index, key], 3600);
    }
  }

  /** Emit the domain event — the listener handles stats + cache invalidation */
  private emitReviewChanged(cabinId: string): void {
    this.eventEmitter.emit(ReviewEvents.CHANGED, { cabinId });
  }

  /* =====================================================
     CREATE REVIEW
  ===================================================== */

  /**
   * Creates a new review for a cabin.
   *
   * Rules:
   * - Rating 1–5 only
   * - Cabin must exist
   * - One review per user per cabin (unique index enforced at DB level too)
   *
   * After creation, emits `review.changed` → listener recomputes cabin stats
   * and busts all related caches.
   */
  async create(userId: string, input: CreateReviewInput): Promise<Review> {
    const { cabinId, rating, comment } = input;

    this.assertRatingValid(rating);
    console.log('STEP 1');

    const cabinExist = await this.cabinModel.findById(cabinId);
    if (!cabinExist) throw new NotFoundException('Cabin not found');
    console.log('STEP 2');

    const exists = await this.reviewModel.findOne({
      userId,
      cabinId,
    });
    if (exists) {
      throw new BadRequestException('You already reviewed this cabin');
    }

    const review = await this.reviewModel.create({
      userId,
      cabinId,
      rating,
      comment,
    });

    this.emitReviewChanged(cabinId.toString());
    return review;
  }

  /* =====================================================
     UPDATE REVIEW
  ===================================================== */

  /**
   * Updates rating and/or comment for a review the caller owns.
   *
   * Rules:
   * - At least one field must be provided
   * - Rating must be 1–5 if provided
   * - Only the review's author may update it
   *
   * Sets `isEdited = true` and records `editedAt`.
   * Emits `review.changed` afterward.
   */
  async update(userId: string, input: UpdateReviewInput): Promise<Review> {
    const { reviewId, rating, comment } = input;

    if (rating === undefined && comment === undefined) {
      throw new BadRequestException('Provide at least one field to update');
    }

    if (rating !== undefined) this.assertRatingValid(rating);

    const review = await this.reviewModel.findById(reviewId);
    if (!review) throw new NotFoundException('Review not found');

    if (review.userId.toString() !== userId) {
      throw new ForbiddenException('Not allowed');
    }

    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    review.isEdited = true;
    review.editedAt = new Date();

    const saved = await review.save();

    this.emitReviewChanged(review.cabinId.toString());
    return saved;
  }

  /* =====================================================
     DELETE REVIEW
  ===================================================== */

  /**
   * Deletes a review.
   *
   * - The review's author OR a MANAGER may delete.
   * Emits `review.changed` afterward.
   */
  async delete(
    user: AuthUser,
    reviewId: string,
  ): Promise<{ success: boolean }> {
    const review = await this.reviewModel.findById(reviewId);
    if (!review) throw new NotFoundException('Review not found');

    if (
      review.userId.toString() !== user._id &&
      user.role !== UserRole.MANAGER
    ) {
      throw new ForbiddenException('Not allowed');
    }

    const cabinId = review.cabinId.toString();
    await this.reviewModel.deleteOne({ _id: reviewId });

    this.emitReviewChanged(cabinId);
    return { success: true };
  }

  /* =====================================================
     FIND ALL (MANAGER / MODERATION)
  ===================================================== */

  /**
   * Returns paginated reviews for admin/moderation purposes.
   * Supports optional `cabinId` and `userId` filters.
   * No caching — managers need real-time data.
   */
  async findAll(query: BaseQuery & { cabinId?: string; userId?: string }) {
    return buildQuery(this.reviewModel, query, {
      defaultSort: 'createdAt',
      searchFields: ['comment'],
      skipFields: ['cabinId', 'userId'],
      customFilter: (q) => {
        const filter: Record<string, any> = {};
        if (q.cabinId) filter.cabin = q.cabinId;
        if (q.userId) filter.user = q.userId;
        return filter;
      },
    });
  }

  /* =====================================================
     REVIEWS BY USER
  ===================================================== */

  /**
   * Returns a paginated list of all reviews made by a specific user.
   * Cached per user+query combination (TTL 60s).
   * Invalidated when any of their reviews change (listener handles cabin-level;
   * user-level entries are short-lived via TTL — acceptable trade-off).
   */
  async findByUser(userId: string, query: ReviewQueryInput) {
    const cacheKey = this.userReviewCacheKey(userId, query);
    const cached = await this.cache.get<ReviewPaginatedResult>(cacheKey);
    if (cached) return cached;

    const data = await buildQuery(this.reviewModel, query, {
      defaultSort: 'createdAt',
      skipFields: ['userId'],
      customFilter: () => ({ user: userId }),
    });

    await this.cache.set(cacheKey, data, REVIEW_CACHE_TTL);
    return data;
  }
  /* =====================================================
     REVIEWS BY CABIN
  ===================================================== */

  /**
   * Returns a paginated, searchable list of reviews for a specific cabin.
   *
   * Cache strategy:
   * - Key = cabin-scoped list key (includes full query params)
   * - Hit → return cached immediately
   * - Miss → query DB, cache result, register key in cabin-scoped index
   * - Invalidation → triggered by `review.changed` event via ReviewStatsListener
   */
  async findByCabin(cabinId: string, query: ReviewQueryInput) {
    const cacheKey = this.reviewCacheKey(cabinId, query);
    const cached = await this.cache.get<ReviewPaginatedResult>(cacheKey);
    if (cached) return cached;

    const data = await buildQuery(this.reviewModel, query, {
      defaultSort: 'createdAt',
      searchFields: ['comment'],
      skipFields: ['cabinId'],
      customFilter: () => ({ cabin: cabinId }),
    });

    await this.cache.set(cacheKey, data, REVIEW_CACHE_TTL);
    await this.trackCabinListKey(cabinId, cacheKey);
    return data;
  }

  /* =====================================================
     PRIVATE — VALIDATION
  ===================================================== */

  private assertRatingValid(rating: number): void {
    console.log('Rating:', rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException(
        'Rating must be an integer between 1 and 5',
      );
    }
  }
}
