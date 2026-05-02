import {
  Resolver,
  Query,
  Mutation,
  Args,
  ID,
  ResolveField,
  Parent,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { BookingService } from './booking.service';
import type { AuthUser } from 'src/review/review.resolver';
import { Booking } from './booking.schema';
import {
  BookingQueryInput,
  CreateBookingInput,
} from './dto/create-booking.input';
import { UpdateBookingInput } from './dto/update-booking.input';
import { UserRole } from '../user/user.schema';
import { Roles } from '../common/decorators/roles.decorator';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  BookingListResponse,
  BookingResponse,
  DeleteResponse,
} from './dto/booking-response.dto';
import { UserLoader } from './loaders/user.loader';
import { CabinLoader } from './loaders/cabin.loader';

/* =====================================================
   RESOLVER
===================================================== */

/**
 * BookingResolver
 *
 * GraphQL layer for all booking-related operations.
 * All business logic is delegated to BookingService — this resolver is
 * intentionally thin and only responsible for:
 *
 *  - Mapping GraphQL operations → service calls
 *  - Applying authentication guards (@UseGuards)
 *  - Enforcing role-based access control (@Roles)
 *  - Resolving relational fields (guest, cabin) via DataLoader to prevent N+1
 *
 * Role matrix:
 * ┌──────────────────────┬────────┬──────────┬─────────┬───────┐
 * │ Operation            │ GUEST  │ EMPLOYEE │ MANAGER │ ADMIN │
 * ├──────────────────────┼────────┼──────────┼─────────┼───────┤
 * │ myBookings           │   ✓    │          │         │       │
 * │ booking (own)        │   ✓    │          │         │       │
 * │ booking (any)        │        │          │    ✓    │   ✓   │
 * │ allBookings          │        │          │    ✓    │   ✓   │
 * │ createBooking        │   ✓    │          │         │       │
 * │ updateBooking        │   ✓    │          │    ✓    │   ✓   │
 * │ cancelBooking        │   ✓    │          │    ✓    │   ✓   │
 * │ confirmBooking       │        │    ✓     │    ✓    │   ✓   │
 * │ checkIn              │        │    ✓     │    ✓    │   ✓   │
 * │ checkOut             │        │    ✓     │    ✓    │   ✓   │
 * │ markNoShow           │        │    ✓     │    ✓    │   ✓   │
 * └──────────────────────┴────────┴──────────┴─────────┴───────┘
 */
@Resolver(() => Booking)
export class BookingResolver {
  constructor(
    private readonly bookingService: BookingService,
    private readonly userLoader: UserLoader,
    private readonly cabinLoader: CabinLoader,
  ) {}

  /* ─────────────────────────────────────────────────────
     FIELD RESOLVERS  (N+1 prevention via DataLoader)
  ───────────────────────────────────────────────────── */

  /**
   * Resolves the `guest` field using a batching DataLoader.
   *
   * Without DataLoader, fetching 50 bookings would fire 50 separate
   * user queries (N+1).  The loader coalesces them into a single
   * `User.find({ _id: { $in: [...ids] } })` per request tick.
   */
  @ResolveField()
  guest(@Parent() booking: Booking) {
    return this.userLoader.batch.load(booking.guest.toString());
  }

  /**
   * Resolves the `cabin` field using a batching DataLoader.
   *
   * Same N+1 protection as the guest resolver above.
   */
  @ResolveField()
  cabin(@Parent() booking: Booking) {
    return this.cabinLoader.batch.load(booking.cabin.toString());
  }

  /* ─────────────────────────────────────────────────────
     QUERIES
  ───────────────────────────────────────────────────── */

  /**
   * Returns all bookings belonging to the authenticated guest.
   *
   * Guests can only see their own history — no cross-user leakage.
   */
  @Roles(UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Query(() => BookingListResponse, {
    description: "Retrieve the authenticated guest's booking history",
  })
  myBookings(@CurrentUser() user: AuthUser) {
    return this.bookingService.findMyBookings(user);
  }

  /**
   * Returns a single booking by ID.
   *
   * - Guests may only fetch their own bookings (ownership enforced in service)
   * - Managers and Admins may fetch any booking
   */
  @Roles(UserRole.GUEST, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Query(() => BookingResponse, {
    description: 'Retrieve a single booking by ID',
  })
  booking(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingService.findOne(id, user);
  }

  /**
   * Returns a paginated, filtered list of all bookings.
   *
   * Restricted to managers and admins.  Supports filtering by guest,
   * cabin, date range, and standard pagination via `query`.
   */
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Query(() => BookingListResponse, {
    description:
      'Retrieve all bookings with optional filtering (admin/manager)',
  })
  async allBookings(
    @Args('query', { nullable: true }) query: BookingQueryInput,
  ) {
    const { data, meta } = await this.bookingService.findAll(query);
    return {
      status: 200,
      message: 'Reviews fetched successfully',
      data,
      meta,
    };
  }

  /* ─────────────────────────────────────────────────────
     MUTATIONS — GUEST OPERATIONS
  ───────────────────────────────────────────────────── */

  /**
   * Creates a new booking for the authenticated guest.
   *
   * The booking starts in PENDING status with a 15-minute payment hold.
   * It transitions to CONFIRMED once payment is captured.
   *
   * Service enforces:
   * - Valid date range
   * - Capacity constraints
   * - No overlapping bookings (cabin or guest)
   * - Price calculation
   */
  @Roles(UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse, {
    description: 'Create a new booking (guest only)',
  })
  createBooking(
    @Args('input') input: CreateBookingInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingService.create(input, user._id);
  }

  /**
   * Updates a booking's dates, cabin, guest count, or options.
   *
   * Allowed by: booking owner (guest) or manager/admin.
   * Terminal bookings (cancelled, checked-out, etc.) cannot be updated.
   * Prices are always recalculated on update.
   */
  @Roles(UserRole.GUEST, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse, {
    description: 'Update an existing booking (owner or manager)',
  })
  updateBooking(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateBookingInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingService.updateBooking(id, input, user);
  }

  /**
   * Soft-cancels a booking.
   *
   * Allowed by: booking owner (guest) or manager/admin.
   * Sets appropriate cancellation status (CANCELLED_BY_GUEST vs CANCELLED_BY_ADMIN).
   * Records who cancelled, when, and optionally why.
   */
  @Roles(UserRole.GUEST, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => DeleteResponse, {
    description: 'Cancel a booking (owner or manager/admin)',
  })
  cancelBooking(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingService.cancelBooking(id, user, reason);
  }

  /* ─────────────────────────────────────────────────────
     MUTATIONS — STAFF OPERATIONS
  ───────────────────────────────────────────────────── */

  /**
   * Confirms payment and transitions booking from PENDING → CONFIRMED.
   *
   * Should be called after a successful payment gateway event or manual
   * staff confirmation.  Only PENDING bookings can be confirmed.
   *
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse, {
    description: 'Confirm payment and activate a pending booking (staff only)',
  })
  confirmBooking(@Args('id', { type: () => ID }) id: string) {
    return this.bookingService.confirmBooking(id);
  }

  /**
   * Checks a guest in, transitioning CONFIRMED → CHECKED_IN.
   *
   * Records the actual timestamp of arrival.
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse, {
    description: 'Check in a confirmed booking (staff only)',
  })
  checkIn(@Args('id', { type: () => ID }) id: string) {
    return this.bookingService.checkIn(id);
  }

  /**
   * Checks a guest out, transitioning CHECKED_IN → CHECKED_OUT.
   *
   * Records checkout timestamp and deactivates the booking.
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse, {
    description: 'Check out an active stay (staff only)',
  })
  checkOut(@Args('id', { type: () => ID }) id: string) {
    return this.bookingService.checkOut(id);
  }

  /**
   * Marks a confirmed booking as NO_SHOW when the guest fails to arrive.
   *
   * Can only be applied to CONFIRMED bookings (guest must not have checked in).
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse, {
    description: 'Mark a booking as no-show (staff only)',
  })
  markNoShow(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingService.markNoShow(id, user);
  }
}
