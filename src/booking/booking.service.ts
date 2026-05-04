import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession, Types } from 'mongoose';
import { differenceInCalendarDays, isBefore } from 'date-fns';

import { Booking, BookingStatus } from './booking.schema';
import { Cabin } from '../cabin/cabin.schema';
import { User, UserRole } from '../user/user.schema';

import {
  BookingQueryInput,
  CreateBookingInput,
} from './dto/create-booking.input';
import { UpdateBookingInput } from './dto/update-booking.input';
import { buildQuery, PaginatedResult } from '../common/utils/query-builder';
import { BookingListResponse } from './dto/booking-response.dto';
import type { AuthUser } from 'src/common/types/AuthUser';

/* =====================================================
   TYPES
===================================================== */

/** Statuses that occupy a cabin / guest slot (i.e. block new bookings) */
const ACTIVE_BLOCKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

/** Statuses that are considered "terminal" and cannot be mutated further */
const TERMINAL_STATUSES: BookingStatus[] = [
  BookingStatus.CANCELLED_BY_GUEST,
  BookingStatus.CANCELLED_BY_ADMIN,
  BookingStatus.CANCELLED_SYSTEM,
  BookingStatus.CHECKED_OUT,
  BookingStatus.EXPIRED,
  BookingStatus.NO_SHOW,
];

/* =====================================================
   SERVICE
===================================================== */

@Injectable()
export class BookingService {
  private lastExpirySweep: Date | null = null;
  private static readonly EXPIRY_DEBOUNCE_MS = 60_000;
  private static readonly BREAKFAST_RATE_PER_GUEST_PER_NIGHT = 5;

  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<Booking>,

    @InjectModel(Cabin.name)
    private readonly cabinModel: Model<Cabin>,

    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  /* ─────────────────────────────────────────────────────
     PRIVATE — DATE HELPERS
  ───────────────────────────────────────────────────── */

  /**
   * Strips the time component and returns a UTC midnight Date.
   * Ensures date comparisons are always day-level, regardless of
   * the caller's timezone or the value coming from user input.
   */
  private toUtcDateOnly(value: string | Date): Date {
    const d = new Date(value);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  /**
   * Guards against logically invalid date ranges:
   * - check-out must be strictly after check-in
   * - check-in must not be in the past
   *
   * Throws BadRequestException with a descriptive message on failure.
   */
  private validateDates(start: Date, end: Date): void {
    const today = this.toUtcDateOnly(new Date());

    if (!isBefore(start, end)) {
      throw new BadRequestException('Check-out must be after check-in date');
    }

    if (isBefore(start, today)) {
      throw new BadRequestException('Check-in date cannot be in the past');
    }
  }

  /**
   * Returns the number of nights between two UTC-midnight dates.
   * Throws if the result is zero or negative (defensive guard).
   */
  private getNights(start: Date, end: Date): number {
    const nights = differenceInCalendarDays(end, start);

    if (nights <= 0) {
      throw new BadRequestException('Invalid booking nights');
    }

    return nights;
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — AUTHORIZATION HELPERS
  ───────────────────────────────────────────────────── */

  /**
   * Returns true when the acting user owns the booking.
   */
  private isBookingOwner(booking: Booking, userId: string): boolean {
    return booking.guestId.toString() === userId;
  }

  /**
   * Returns true when the acting user has elevated privileges.
   * Both ADMIN and MANAGER can manage any booking.
   */
  private isPrivileged(user: AuthUser): boolean {
    return user.role === UserRole.MANAGER;
  }

  /**
   * Throws ForbiddenException unless the user owns the booking OR has
   * elevated privileges.  Use this as a single authorisation gate.
   */
  private assertOwnerOrPrivileged(booking: Booking, user: AuthUser): void {
    if (!this.isBookingOwner(booking, user._id) && !this.isPrivileged(user)) {
      throw new ForbiddenException('Access denied');
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — STATUS HELPERS
  ───────────────────────────────────────────────────── */

  /**
   * Throws BadRequestException if the booking is in a terminal state
   * (i.e. it can no longer be mutated).
   */
  private assertMutable(booking: Booking): void {
    if (TERMINAL_STATUSES.includes(booking.status)) {
      throw new BadRequestException(
        `Booking in status "${booking.status}" cannot be modified`,
      );
    }
  }

  /**
   * Throws BadRequestException if the booking is not in the expected status.
   * Used by check-in / check-out flows where a specific prior state is required.
   */
  private assertStatus(booking: Booking, expected: BookingStatus): void {
    if (booking.status !== expected) {
      throw new BadRequestException(
        `Expected booking status "${expected}" but found "${booking.status}"`,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — PRICING
  ───────────────────────────────────────────────────── */

  /**
   * Calculates the breakdown of costs for a booking.
   *
   * - Cabin price  = (regularPrice − discount) × nights  (floored at 0)
   * - Extras price = hasBreakfast ? guests × nights × BREAKFAST_RATE : 0
   * - Total        = cabinPrice + extrasPrice
   *
   * The breakfast rate is intentionally a named constant so it can be
   * updated in one place or moved to config.
   */

  private calculatePrice(
    cabin: Cabin,
    nights: number,
    guests: number,
    hasBreakfast = false,
  ): { cabinPrice: number; extrasPrice: number; totalPrice: number } {
    const regularPrice = Number(cabin.regularPrice ?? 0);
    const discount = Number(cabin.discount ?? 0);

    const nightlyRate = Math.max(regularPrice - discount, 0);
    const cabinPrice = nightlyRate * nights;

    const extrasPrice = hasBreakfast
      ? guests * nights * BookingService.BREAKFAST_RATE_PER_GUEST_PER_NIGHT
      : 0;

    return {
      cabinPrice,
      extrasPrice,
      totalPrice: cabinPrice + extrasPrice,
    };
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — CONFLICT DETECTION
  ───────────────────────────────────────────────────── */

  /**
   * Returns a Mongoose filter that matches bookings which "block" a date
   * range (i.e. overlap with [start, end) and are in an active status).
   *
   * Date overlap condition:  existing.start < end  AND  existing.end > start
   */
  private buildConflictFilter(
    start: Date,
    end: Date,
    excludeId?: string,
  ): Record<string, any> {
    const filter: Record<string, any> = {
      status: { $in: ACTIVE_BLOCKING_STATUSES },
      active: true,
      startDate: { $lt: end },
      endDate: { $gt: start },
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    return filter;
  }

  /**
   * Validates that the requested cabin AND the guest have no overlapping
   * active bookings.  Both checks run sequentially within the same session
   * so the validation is transaction-safe.
   *
   * @param cabinId   Cabin being booked
   * @param guestId   Guest making the booking
   * @param start     Check-in date (UTC midnight)
   * @param end       Check-out date (UTC midnight)
   * @param excludeId Booking to ignore (used during updates to exclude self)
   * @param session   Active Mongoose session for transaction safety
   */
  private async assertNoConflicts(params: {
    cabinId: string;
    guestId: string;
    start: Date;
    end: Date;
    excludeId?: string;
    session: ClientSession;
  }): Promise<void> {
    const { cabinId, guestId, start, end, excludeId, session } = params;
    const baseFilter = this.buildConflictFilter(start, end, excludeId);

    const cabinConflict = await this.bookingModel
      .findOne({ ...baseFilter, cabinId })
      .session(session);
    if (cabinConflict) {
      throw new ConflictException('Cabin already booked for selected dates');
    }

    const guestConflict = await this.bookingModel
      .findOne({ ...baseFilter, guestId })
      .session(session);

    if (guestConflict) {
      throw new ConflictException(
        'You already have another booking in this range',
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — LOOKUP HELPERS
  ───────────────────────────────────────────────────── */

  /**
   * Safe ObjectId validator
   */
  private ensureValidObjectId(id: string, field: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${field} is invalid`);
    }

    return new Types.ObjectId(id);
  }

  /**
   * Fetches a booking by ID and throws NotFoundException if missing.
   */
  private async findBookingOrFail(
    id: string,
    session?: ClientSession,
  ): Promise<Booking> {
    const bookingId = this.ensureValidObjectId(id, 'Booking ID');

    const query = this.bookingModel.findById(bookingId);

    if (session) query.session(session);

    const booking = await query.exec();

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  /**
   * Fetches a cabin by ID and throws NotFoundException if missing.
   */
  private async findCabinOrFail(
    id: string,
    session?: ClientSession,
  ): Promise<Cabin> {
    const cabinId = this.ensureValidObjectId(id, 'Cabin ID');

    const query = this.cabinModel.findById(cabinId);

    if (session) query.session(session);

    const cabin = await query.exec();

    if (!cabin) {
      throw new NotFoundException('Cabin not found');
    }

    return cabin;
  }

  /**
   * Fetches a user by ID and throws NotFoundException if missing.
   */
  private async findUserOrFail(
    id: string,
    session?: ClientSession,
  ): Promise<User> {
    const userId = this.ensureValidObjectId(id, 'User ID');

    const query = this.userModel.findById(userId);

    if (session) query.session(session);

    const user = await query.exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
  /* ─────────────────────────────────────────────────────
     PRIVATE — TRANSACTION HELPER
  ───────────────────────────────────────────────────── */

  /**
   * Wraps a callback in a Mongoose session + transaction, ensuring the
   * session is always ended regardless of success or failure.
   *
   * Usage keeps individual methods clean and avoids duplicating the
   * try/finally pattern everywhere.
   */
  private async withTransaction<T>(
    fn: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.bookingModel.db.startSession();

    try {
      session.startTransaction();

      const result = await fn(session);

      await session.commitTransaction();

      return result;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      await session.endSession();
    }
  }
  /* ─────────────────────────────────────────────────────
     AUTO EXPIRE
  ───────────────────────────────────────────────────── */

  /**
   * Marks all PENDING bookings whose payment hold has elapsed as EXPIRED.
   *
   * This is called at the start of any read or write operation that cares
   * about availability, ensuring stale holds are cleaned up lazily rather
   * than requiring a background cron (though a cron is a good complement).
   *
   * BUG FIX: the original query incorrectly filtered by `status: EXPIRED`.
   * It should filter by `status: PENDING` — only pending bookings can expire.
   */
  async autoExpirePendingBookings(options?: {
    session?: ClientSession;
    force?: boolean;
  }): Promise<void> {
    {
      const now = new Date();

      if (
        !options?.force &&
        this.lastExpirySweep &&
        now.getTime() - this.lastExpirySweep.getTime() <
          BookingService.EXPIRY_DEBOUNCE_MS
      ) {
        return;
      }

      this.lastExpirySweep = now;

      await this.bookingModel.updateMany(
        {
          status: BookingStatus.PENDING,
          paymentDueAt: { $lt: now },
          active: true,
        },
        {
          $set: {
            status: BookingStatus.EXPIRED,
            active: false,
            expiredAt: now,
          },
        },
        options?.session ? { session: options.session } : {},
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     CREATE
  ───────────────────────────────────────────────────── */

  /**
   * Creates a new booking inside a transaction.
   *
   * Flow:
   * 1. Expire any stale pending holds
   * 2. Validate date range
   * 3. Assert cabin + user exist
   * 4. Assert guest count ≤ cabin capacity
   * 5. Check for date conflicts (cabin & guest)
   * 6. Calculate pricing
   * 7. Persist with a 15-minute payment hold (paymentDueAt)
   *
   * The booking starts in PENDING status; it becomes CONFIRMED once payment
   * is captured via `confirmBooking`.
   *
   * @param input   Validated booking input DTO
   * @param guestId Authenticated user's ID (injected from JWT)
   */
  async create(input: CreateBookingInput, guestId: string): Promise<Booking> {
    return this.withTransaction(async (session) => {
      const { cabinId, startDate, endDate, numGuests, hasBreakfast } = input;

      const start = this.toUtcDateOnly(startDate);
      const end = this.toUtcDateOnly(endDate);

      this.validateDates(start, end);

      //await this.autoExpirePendingBookings({ session });

      const cabin = await this.findCabinOrFail(cabinId, session);
      const user = await this.findUserOrFail(guestId, session);

      if (numGuests > cabin.maxCapacity) {
        throw new BadRequestException(
          `This cabin allows a maximum of ${cabin.maxCapacity} guests`,
        );
      }

      await this.assertNoConflicts({
        cabinId,
        guestId,
        start,
        end,
        session,
      });

      const nights = this.getNights(start, end);

      const prices = this.calculatePrice(
        cabin,
        nights,
        numGuests,
        hasBreakfast,
      );

      const [booking] = await this.bookingModel.create(
        [
          {
            guestId: user._id,
            cabinId: cabin._id,
            startDate: start,
            endDate: end,
            numGuests,
            hasBreakfast,
            numNights: nights,
            ...prices,
            status: BookingStatus.PENDING,
            active: true,
            paymentDueAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        ],
        { session },
      );

      return booking;
    });
  }
  /* ─────────────────────────────────────────────────────
     READ — SINGLE
  ───────────────────────────────────────────────────── */

  /**
   * Returns a single booking by ID, populating cabin and guest references.
   *
   * Admins and managers can fetch any booking.
   * Guests can only fetch their own.
   *
   * @param id   Booking ObjectId
   * @param user Authenticated user (used for ownership check)
   */
  async findOne(id: string, user: AuthUser): Promise<Booking> {
    const booking = await this.bookingModel.findById(id);

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    console.log(booking);
    if (!this.isPrivileged(user) && !this.isBookingOwner(booking, user._id)) {
      throw new ForbiddenException('Access denied');
    }

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     READ — MY BOOKINGS
  ───────────────────────────────────────────────────── */

  /**
   * Returns all bookings for the currently authenticated guest,
   * sorted newest-first.
   *
   * @param user Authenticated user (guest)
   */
  async findMyBookings(user: AuthUser): Promise<BookingListResponse> {
    const guestId =
      typeof user._id === 'string' ? new Types.ObjectId(user._id) : user._id;

    const bookings = await this.bookingModel
      .find({ guestId })
      .sort({ createdAt: -1 });

    return {
      status: 200,
      message: 'success',
      data: bookings,
    };
  }
  /* ─────────────────────────────────────────────────────
     READ — ALL (ADMIN / MANAGER)
  ───────────────────────────────────────────────────── */

  /**
   * Returns a paginated, filtered list of all bookings.
   *
   * Supported filter parameters (via BookingQueryInput):
   * - `guestId`   — filter by guest
   * - `cabinId`   — filter by cabin
   * - `startDate` + `endDate` — range overlap filter
   * - Standard `buildQuery` fields (page, limit, sort, search)
   *
   * Stale pending holds are expired before returning results.
   *
   * @param query Pagination + filter input
   */
  async findAll(query: BookingQueryInput): Promise<PaginatedResult<Booking>> {
    //  await this.autoExpirePendingBookings();

    return buildQuery(this.bookingModel, query, {
      defaultSort: 'createdAt',

      skipFields: ['guestId', 'cabinId', 'startDate', 'endDate'],

      customFilter: (q) => {
        const filter: Record<string, any> = {};

        if (q.guestId) filter.guestId = q.guestId;
        if (q.cabinId) filter.cabinId = q.cabinId;

        if (q.startDate && q.endDate) {
          filter.startDate = { $lt: q.endDate };
          filter.endDate = { $gt: q.startDate };
        }

        return filter;
      },
    });
  }

  /* ─────────────────────────────────────────────────────
     UPDATE
  ───────────────────────────────────────────────────── */

  /**
   * Updates mutable fields on an existing booking inside a transaction.
   *
   * Authorization rules:
   * - Booking owner (guest) OR admin/manager may update
   *
   * Invariants enforced:
   * - Booking must not be in a terminal status
   * - New date range must be valid
   * - Cabin must exist and have sufficient capacity
   * - No conflicts with other active bookings (self excluded)
   * - Prices are recalculated on every update
   *
   * @param id    Booking ObjectId
   * @param dto   Partial update payload
   * @param user  Authenticated user
   */
  async updateBooking(
    id: string,
    dto: UpdateBookingInput,
    user: AuthUser,
  ): Promise<Booking> {
    return this.withTransaction(async (session) => {
      const booking = await this.findBookingOrFail(id, session);

      this.assertOwnerOrPrivileged(booking, user);
      this.assertMutable(booking);

      const cabinId = dto.cabinId ?? booking.cabinId.toString();
      const start = this.toUtcDateOnly(dto.startDate ?? booking.startDate);
      const end = this.toUtcDateOnly(dto.endDate ?? booking.endDate);
      const numGuests = dto.numGuests ?? booking.numGuests;
      const hasBreakfast = dto.hasBreakfast ?? booking.hasBreakfast;

      this.validateDates(start, end);

      const cabin = await this.findCabinOrFail(cabinId, session);

      if (numGuests > cabin.maxCapacity) {
        throw new BadRequestException(
          `This cabin allows a maximum of ${cabin.maxCapacity} guests`,
        );
      }

      console.log(id, 'id');
      await this.assertNoConflicts({
        cabinId,
        guestId: booking.guestId.toString(),
        start,
        end,
        excludeId: id,
        session,
      });

      const nights = this.getNights(start, end);
      const prices = this.calculatePrice(
        cabin,
        nights,
        numGuests,
        hasBreakfast,
      );

      booking.cabinId = new Types.ObjectId(cabinId);
      booking.startDate = start;
      booking.endDate = end;
      booking.numGuests = numGuests;
      booking.hasBreakfast = hasBreakfast;
      booking.numNights = nights;
      booking.cabinPrice = prices.cabinPrice;
      booking.extrasPrice = prices.extrasPrice;
      booking.totalPrice = prices.totalPrice;

      if (dto.observations !== undefined) {
        booking.observations = dto.observations;
      }

      await booking.save({ session });

      return booking;
    });
  }

  /* ─────────────────────────────────────────────────────
     CANCEL
  ───────────────────────────────────────────────────── */

  /**
   * Soft-cancels a booking, recording who cancelled it and why.
   *
   * - Guests cancel their own booking → status CANCELLED_BY_GUEST
   * - Admins/managers cancel any booking → status CANCELLED_BY_ADMIN
   *
   * BUG FIX: the original only checked `MANAGER` for the isAdmin path;
   * ADMIN role was excluded, breaking admin-initiated cancellations.
   *
   * @param id     Booking ObjectId
   * @param user   Authenticated user
   * @param reason Optional human-readable cancellation reason
   */
  async cancelBooking(
    id: string,
    user: AuthUser,
    reason?: string,
  ): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    this.assertOwnerOrPrivileged(booking, user); // ← now covers ADMIN too

    if (
      booking.status === BookingStatus.CANCELLED_SYSTEM ||
      booking.status === BookingStatus.CANCELLED_BY_GUEST ||
      booking.status === BookingStatus.CANCELLED_BY_ADMIN
    ) {
      throw new BadRequestException('Booking is already cancelled');
    }

    this.assertMutable(booking);

    const cancelledByAdmin = this.isPrivileged(user);

    booking.status = cancelledByAdmin
      ? BookingStatus.CANCELLED_BY_ADMIN
      : BookingStatus.CANCELLED_BY_GUEST;

    booking.active = false;
    booking.cancelReason =
      reason ??
      (cancelledByAdmin ? 'Cancelled by admin' : 'Cancelled by guest');
    booking.cancelledAt = new Date();
    booking.cancelledBy = new Types.ObjectId(user._id);

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     CONFIRM PAYMENT
  ───────────────────────────────────────────────────── */

  /**
   * Marks a booking as paid and transitions its status to CONFIRMED.
   *
   * This should be called after a successful payment webhook or manual
   * payment confirmation by staff.  Only PENDING bookings can be confirmed
   * — already confirmed or terminal bookings are rejected.
   *
   * @param id Booking ObjectId
   */
  async confirmBooking(id: string): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be confirmed');
    }

    booking.status = BookingStatus.CONFIRMED;
    booking.isPaid = true;

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     CHECK IN
  ───────────────────────────────────────────────────── */

  /**
   * Transitions a booking from CONFIRMED → CHECKED_IN.
   *
   * Records the actual check-in timestamp.  Only staff (EMPLOYEE / MANAGER)
   * should be allowed to call this (enforced in the resolver via @Roles).
   *
   * @param id Booking ObjectId
   */
  async checkIn(id: string): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    this.assertStatus(booking, BookingStatus.CONFIRMED);

    booking.status = BookingStatus.CHECKED_IN;
    booking.checkedInAt = new Date();

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     CHECK OUT
  ───────────────────────────────────────────────────── */

  /**
   * Transitions a booking from CHECKED_IN → CHECKED_OUT.
   *
   * Records the actual check-out timestamp and deactivates the booking.
   * The booking is considered fully complete after this step.
   *
   * @param id Booking ObjectId
   */
  async checkOut(id: string): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    this.assertStatus(booking, BookingStatus.CHECKED_IN);

    booking.status = BookingStatus.CHECKED_OUT;
    booking.active = false;
    booking.checkedOutAt = new Date();

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     MARK NO-SHOW
  ───────────────────────────────────────────────────── */

  /**
   * Marks a confirmed booking as NO_SHOW when the guest fails to arrive.
   *
   * Can only be applied to CONFIRMED bookings (not already checked-in).
   * Deactivates the booking record.
   *
   * @param id   Booking ObjectId
   * @param user Authenticated staff user (EMPLOYEE / MANAGER)
   */
  async markNoShow(id: string, user: AuthUser): Promise<Booking> {
    if (!this.isPrivileged(user) && user.role !== UserRole.EMPLOYEE) {
      throw new ForbiddenException('Only staff can mark a no-show');
    }

    const booking = await this.findBookingOrFail(id);

    this.assertStatus(booking, BookingStatus.CONFIRMED);

    booking.status = BookingStatus.NO_SHOW;
    booking.active = false;

    await booking.save();

    return booking;
  }
}
