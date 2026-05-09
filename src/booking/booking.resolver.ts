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
import { Booking } from './booking.schema';
import {
  BookingQueryInput,
  CreateBookingInput,
} from './dto/create-booking.input';
import { UpdateBookingInput } from './dto/update-booking.input';
import { User, UserRole } from '../user/user.schema';
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
import { Cabin } from 'src/cabin/cabin.schema';
import type { AuthUser } from 'src/common/types/AuthUser';

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
  @ResolveField(() => User)
  guest(@Parent() booking: Booking) {
    return this.userLoader.batch.load(booking.guestId.toString());
  }

  /**
   * Resolves the `cabin` field using a batching DataLoader.
   *
   * Same N+1 protection as the guest resolver above.
   */

  @ResolveField(() => Cabin)
  cabin(@Parent() booking: Booking) {
    return this.cabinLoader.batch.load(booking.cabinId.toString());
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
  @Query(() => BookingListResponse)
  myBookings(@CurrentUser() user: AuthUser): Promise<BookingListResponse> {
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
  @Query(() => BookingResponse)
  async booking(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.findOne(id, user);

    return {
      status: 200,
      message: 'Booking retrieved successfully',
      data: booking,
    };
  }
  /**
   * Returns a paginated, filtered list of all bookings.
   *
   * Restricted to managers and admins.  Supports filtering by guest,
   * cabin, date range, and standard pagination via `query`.
   */
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Query(() => BookingListResponse)
  async allBookings(
    @Args('query', { nullable: true }) query: BookingQueryInput,
  ): Promise<BookingListResponse> {
    const result = await this.bookingService.findAll(query);

    return {
      status: 200,
      message: 'Bookings retrieved successfully',
      data: result.data,
      meta: result.meta,
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
  @Mutation(() => BookingResponse)
  async createBooking(
    @Args('input') input: CreateBookingInput,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.create(input, user._id);

    return {
      status: 201,
      message: 'Booking created successfully',
      data: booking,
    };
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
  @Mutation(() => BookingResponse)
  async updateBooking(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateBookingInput,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.updateBooking(id, input, user);

    return {
      status: 200,
      message: 'Booking updated successfully',
      data: booking,
    };
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
  @Mutation(() => DeleteResponse)
  async cancelBooking(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DeleteResponse> {
    await this.bookingService.cancelBooking(id, user, reason);

    return {
      status: 200,
      message: 'Booking cancelled successfully',
      id,
    };
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
  @Mutation(() => BookingResponse)
  async confirmBooking(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.confirmBooking(id);

    return {
      status: 200,
      message: 'Booking confirmed successfully',
      data: booking,
    };
  }

  /**
   * Checks a guest in, transitioning CONFIRMED → CHECKED_IN.
   *
   * Records the actual timestamp of arrival.
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse)
  async checkIn(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.checkIn(id);

    return {
      status: 200,
      message: 'Guest checked in successfully',
      data: booking,
    };
  }

  /**
   * Checks a guest out, transitioning CHECKED_IN → CHECKED_OUT.
   *
   * Records checkout timestamp and deactivates the booking.
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse)
  async checkOut(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.checkOut(id);

    return {
      status: 200,
      message: 'Guest checked out successfully',
      data: booking,
    };
  }

  /**
   * Marks a confirmed booking as NO_SHOW when the guest fails to arrive.
   *
   * Can only be applied to CONFIRMED bookings (guest must not have checked in).
   * Restricted to staff: EMPLOYEE, MANAGER, ADMIN.
   */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => BookingResponse)
  async markNoShow(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingResponse> {
    const booking = await this.bookingService.markNoShow(id, user);

    return {
      status: 200,
      message: 'Booking marked as no-show',
      data: booking,
    };
  }
}
