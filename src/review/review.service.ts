import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Review } from './review.schema';
import { Cabin } from '../cabin/cabin.schema';
import { buildQuery, BaseQuery } from 'src/common/utils/query-builder';
import { UserRole } from 'src/user/user.schema';
import { UpdateReviewInput } from './dto/update-review.input';
import { CreateReviewInput } from './dto/create-review.input';
import { reviewListIndexKey } from '../common/listeners/review-stats.listener';
import { ReviewQueryInput } from './dto/review-query.input';
import type { AuthUser } from 'src/common/types/AuthUser';
import { ReviewEventPublisher } from 'src/common/events/review-event.publisher';
import { Booking, BookingStatus } from 'src/booking/booking.schema';

/** Cache TTL for review lists (seconds) */
const REVIEW_CACHE_TTL = 60;

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
  //private readonly logger = new Logger(ReviewService.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<Review>,

    @InjectModel(Cabin.name) private cabinModel: Model<Cabin>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private readonly reviewEvents: ReviewEventPublisher,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  /**
   * Safe ObjectId validator
   */
  private ensureValidObjectId(id: string, field: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${field} is invalid`);
    }

    return new Types.ObjectId(id);
  }

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

  /* =====================================================
     CREATE REVIEW
  ===================================================== */

  /**
   * Creates a new review for a cabin.
   *
   * Rules:
   * - Rating 1–5 only (integer)
   * - Cabin must exist
   * - One review per user per cabin (unique index enforced at DB level too)
   *
   * After creation, emits `review.changed` → listener recomputes cabin stats
   * and busts all related caches.
   */
  async create(user: string, input: CreateReviewInput): Promise<Review> {
    const { bookingId: booking, rating, comment } = input;

    this.assertRatingValid(rating);

    const userId = this.ensureValidObjectId(user, 'User ID');
    const bookingId = this.ensureValidObjectId(booking, 'Booking ID');

    // Prevent duplicate review
    const exists = await this.reviewModel.findOne({
      bookingId,
    });
    if (exists) {
      throw new BadRequestException('Booking already reviewed');
    }

    // Find booking
    const foundBooking = await this.bookingModel.findById(bookingId);

    if (!foundBooking) {
      throw new NotFoundException('Booking not found');
    }

    // Ownership validation
    if (foundBooking.guestId.toString() !== userId.toString()) {
      throw new ForbiddenException('You can review only your bookings');
    }

    // Only checked out bookings
    if (foundBooking.status !== BookingStatus.CHECKED_OUT) {
      throw new BadRequestException('You can review only completed stays');
    }

    const review = await this.reviewModel.create({
      bookingId,
      userId,
      cabinId: foundBooking.cabinId,
      rating,
      comment,
    });

    this.reviewEvents.reviewChanged(foundBooking.cabinId);

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
   * - Rating must be 1–5 integer if provided
   * - Only the review's author may update it
   *
   * Sets `isEdited = true` and records `updatedAt/'[]`.
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
    review.updatedAt = new Date();

    const saved = await review.save();

    this.reviewEvents.reviewChanged(review.cabinId);
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
  async delete(user: AuthUser, review: string): Promise<{ success: boolean }> {
    const reviewId = this.ensureValidObjectId(review, 'Review ID');
    const foundReview = await this.reviewModel.findById(reviewId);
    if (!foundReview) throw new NotFoundException('Review not found');

    if (
      foundReview.userId.toString() !== user._id &&
      user.role !== UserRole.MANAGER
    ) {
      throw new ForbiddenException('Not allowed');
    }

    const cabinId = foundReview.cabinId.toString();
    await this.reviewModel.deleteOne({ _id: reviewId });

    this.reviewEvents.reviewChanged(cabinId);
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
  async findAll(
    query: BaseQuery & { cabinId?: Types.ObjectId; userId?: Types.ObjectId },
  ) {
    console.log(typeof query.userId);
    return buildQuery(this.reviewModel, query, {
      defaultSort: 'createdAt',
      searchFields: ['comment'],
      skipFields: ['cabinId', 'userId'],
      customFilter: (q) => {
        const filter: Record<string, any> = {};
        if (q.cabinId) filter.cabinId = q.cabinId;
        if (q.userId) filter.userId = q.userId;
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
   */
  async findByUser(user: string, query: ReviewQueryInput) {
    const userId = this.ensureValidObjectId(user, 'User ID');
    const cacheKey = this.userReviewCacheKey(user, query);
    const cached = await this.cache.get<ReviewPaginatedResult>(cacheKey);
    if (cached) return cached;
    const data = await buildQuery(
      this.reviewModel,
      query as unknown as Record<string, unknown>,
      {
        searchFields: ['rating', 'comment'],

        defaultSort: 'createdAt',
        skipFields: ['userId'],
        customFilter: () => ({ userId }),
      },
    );

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
  async findByCabin(cabin: string, query: ReviewQueryInput) {
    const cacheKey = this.reviewCacheKey(cabin, query);
    const cabinId = this.ensureValidObjectId(cabin, 'Cabin ID');
    const cached = await this.cache.get<ReviewPaginatedResult>(cacheKey);
    if (cached) return cached;

    const data = await buildQuery(this.reviewModel, query && cabinId, {
      defaultSort: 'createdAt',
      searchFields: ['comment'],
      skipFields: ['cabinId'],
      // FIX: use correct field name (cabinId) not (cabin)
      customFilter: () => ({ cabinId }),
    });

    await this.cache.set(cacheKey, data, REVIEW_CACHE_TTL);
    await this.trackCabinListKey(cabin, cacheKey);
    return data;
  }

  /* =====================================================
     PRIVATE — VALIDATION
  ===================================================== */

  // FIX: use Number.isInteger instead of Number.isFinite to properly
  // reject floats like 3.5 and non-numeric values
  private assertRatingValid(rating: number): void {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException(
        'Rating must be an integer between 1 and 5',
      );
    }
  }
}
