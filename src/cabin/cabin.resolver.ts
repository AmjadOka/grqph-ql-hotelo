import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { CabinService } from './cabin.service';
import { Cabin } from './cabin.schema';
import { CreateCabinInput } from './dto/create-cabin.input';
import { UpdateCabinInput } from './dto/update-cabin.input';
import { CabinQueryInput } from './dto/query-cabin-input.dto';
import { CabinsResponse } from './dto/response-query.dto';

import { Roles } from '../common/decorators/roles.decorator';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { UserRole } from '../user/user.schema';

/**
 * CabinResolver
 *
 * GraphQL layer for cabin management.
 * All business logic is delegated to CabinService.
 *
 * Role matrix:
 * ┌──────────────────┬────────┬──────────┬─────────┬───────┬────────────┐
 * │ Operation        │ PUBLIC │  GUEST   │EMPLOYEE │MANAGER│   ADMIN    │
 * ├──────────────────┼────────┼──────────┼─────────┼───────┼────────────┤
 * │ cabins (list)    │   ✓    │    ✓     │    ✓    │   ✓   │     ✓      │
 * │ cabin (single)   │   ✓    │    ✓     │    ✓    │   ✓   │     ✓      │
 * │ createCabin      │        │          │         │   ✓   │     ✓      │
 * │ updateCabin      │        │          │         │   ✓   │     ✓      │
 * │ removeCabin      │        │          │         │   ✓   │     ✓      │
 * └──────────────────┴────────┴──────────┴─────────┴───────┴────────────┘
 *
 * cabins + cabin are intentionally public — guests need to browse
 * available cabins before authenticating / making a booking.
 */
@Resolver(() => Cabin)
export class CabinResolver {
  constructor(private readonly cabinService: CabinService) {}

  /* ─────────────────────────────────────────────────────
     QUERIES
  ───────────────────────────────────────────────────── */

  /**
   * Returns a paginated, filtered list of cabins.
   *
   * Public endpoint — no authentication required.
   * Supports filtering by price range, capacity, and text search.
   * Results are cached; cache is invalidated on any mutation.
   */
  @Query(() => CabinsResponse, {
    description: 'List all cabins with optional filtering and pagination',
  })
  cabins(@Args('query', { nullable: true }) query: CabinQueryInput) {
    return this.cabinService.findAll(query ?? {});
  }

  /**
   * Returns a single cabin by ID.
   *
   * Public endpoint — guests need cabin details before booking.
   * Result is individually cached by ID.
   */
  @Query(() => Cabin, {
    name: 'cabin',
    description: 'Retrieve a single cabin by ID',
  })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.cabinService.findOne(id);
  }

  /* ─────────────────────────────────────────────────────
     MUTATIONS
  ───────────────────────────────────────────────────── */

  /**
   * Creates a new cabin.
   *
   * Enforces:
   * - Unique cabin name
   * - Discount < regularPrice
   *
   * Invalidates all list caches on success.
   */
  @Roles(UserRole.MANAGER, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Cabin, {
    description: 'Create a new cabin (manager only)',
  })
  createCabin(@Args('input') input: CreateCabinInput) {
    return this.cabinService.create(input);
  }

  /**
   * Updates an existing cabin's fields.
   *
   * Enforces:
   * - Cabin existence
   * - Unique name (if name is being changed)
   * - Discount < regularPrice after update
   *
   * Invalidates the specific cabin cache + all list caches.
   */
  @Roles(UserRole.MANAGER, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Cabin, {
    description: 'Update a cabin by ID (manager only)',
  })
  updateCabin(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCabinInput,
  ) {
    return this.cabinService.update(id, input);
  }

  /**
   * Permanently removes a cabin.
   *
   * Returns true on success.
   * Invalidates the specific cabin cache + all list caches.
   */
  @Roles(UserRole.MANAGER, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean, {
    description: 'Delete a cabin by ID (manager only)',
  })
  removeCabin(@Args('id', { type: () => ID }) id: string) {
    return this.cabinService.remove(id);
  }
}
