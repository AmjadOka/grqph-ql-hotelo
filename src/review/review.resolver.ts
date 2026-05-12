import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';

import { ReviewService } from './review.service';
import { GqlAuthGuard } from 'src/common/guards/gql-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

import { CreateReviewInput } from './dto/create-review.input';
import { UpdateReviewInput } from './dto/update-review.input';
import { ReviewQueryInput } from './dto/review-query.input';

import {
  ReviewListResponse,
  ReviewResponse,
  DeleteReviewResponse,
} from './dto/review-response.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/user/user.schema';
import { UseGuards } from '@nestjs/common';
import type { AuthUser } from 'src/common/types/AuthUser';

/**
 * ReviewResolver
 *
 * GraphQL layer — delegates all logic to ReviewService.
 *
 * Role matrix:
 * ┌─────────────────────┬────────┬──────────┬─────────┬────────┐
 * │ Operation           │ PUBLIC │  GUEST   │ MANAGER │ ADMIN  │
 * ├─────────────────────┼────────┼──────────┼─────────┼────────┤
 * │ cabinReviews (list) │   ✓    │    ✓     │    ✓    │   ✓    │
 * │ myReviews           │        │    ✓     │    ✓    │   ✓    │
 * │ reviews (all)       │        │          │    ✓    │   ✓    │
 * │ createReview        │        │    ✓     │    ✓    │   ✓    │
 * │ updateReview        │        │    ✓     │    ✓    │   ✓    │
 * │ deleteReview        │        │    ✓*    │    ✓    │   ✓    │
 * └─────────────────────┴────────┴──────────┴─────────┴────────┘
 * * GUEST may only delete their own review; MANAGER may delete any.
 */
@Resolver()
export class ReviewResolver {
  constructor(private readonly reviewService: ReviewService) {}

  /* =====================================================
     MUTATIONS
  ===================================================== */
  @Roles(UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => ReviewResponse, {
    description: 'Submit a review for a cabin (authenticated users)',
  })
  async createReview(
    @Args('input') input: CreateReviewInput,
    @CurrentUser() user: AuthUser,
  ) {
    console.log('INPUT:', JSON.stringify(input));
    console.log('USER:', JSON.stringify(user));

    const review = await this.reviewService.create(user.sub, input);
    return {
      status: 201,
      message: 'Review created successfully',
      data: review,
    };
  }

  @UseGuards(GqlAuthGuard)
  @Mutation(() => ReviewResponse, {
    description: 'Update your own review',
  })
  async updateReview(
    @Args('input') input: UpdateReviewInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewResponse> {
    const review = await this.reviewService.update(user.sub, input);
    return {
      status: 200,
      message: 'Review updated successfully',
      data: review,
    };
  }

  /**
   * Guests may delete their own review; managers may delete any.
   * Service enforces the ownership check.
   */
  @Roles(UserRole.GUEST, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => DeleteReviewResponse, {
    description: 'Delete a review (owner or manager)',
  })
  async deleteReview(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DeleteReviewResponse> {
    const result = await this.reviewService.delete(user, id);
    return {
      status: 200,
      message: 'Review deleted successfully',
      success: result.success,
    };
  }

  /* =====================================================
     QUERIES
  ===================================================== */

  /**
   * Public — anyone can browse reviews for a cabin.
   * Results are cached; cache is busted on any review mutation for that cabin.
   */
  @Query(() => ReviewListResponse, {
    description: 'Get paginated reviews for a specific cabin (public)',
  })
  async cabinReviews(
    @Args('cabinId', { type: () => ID }) cabinId: string,
    @Args('query', { nullable: true }) query?: ReviewQueryInput,
  ): Promise<ReviewListResponse> {
    return {
      status: 200,
      message: 'Cabin reviews fetched successfully',
      data: await this.reviewService.findByCabin(cabinId, query ?? {}),
    };
  }

  /** Returns the current user's own reviews. */
  @Roles(UserRole.GUEST, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Query(() => ReviewListResponse, {
    description: "Get the authenticated user's own reviews",
  })
  async myReviews(
    @CurrentUser() user: AuthUser,
    @Args('query', { nullable: true }) query?: ReviewQueryInput,
  ): Promise<ReviewListResponse> {
    const data = await this.reviewService.findByUser(user.sub, query ?? {});
    return {
      status: 200,
      message: 'My reviews fetched successfully',
      data,
    };
  }

  /** Admin / moderation view — full review list with optional filters. */
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Query(() => ReviewListResponse, {
    description: 'List all reviews with optional filters (manager only)',
  })
  async reviews(
    @Args('query', { nullable: true }) query?: ReviewQueryInput,
  ): Promise<ReviewListResponse> {
    const data = await this.reviewService.findAll(query ?? {});

    return {
      status: 200,
      message: 'Reviews fetched successfully',
      data,
    };
  }
}
