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

import { Booking, BookingStatus, PaymentStatus } from './booking.schema';
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

import { BookingEventPublisher } from 'src/notification/events/booking-event.publisher';
/* =====================================================
   CONSTANTS
===================================================== */

const ACTIVE_BLOCKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

const TERMINAL_STATUSES: BookingStatus[] = [
  BookingStatus.CANCELLED_BY_GUEST,
  BookingStatus.CANCELLED_BY_ADMIN,
  BookingStatus.CANCELLED_SYSTEM,
  BookingStatus.CHECKED_OUT,
  BookingStatus.EXPIRED,
  BookingStatus.NO_SHOW,
];

const PAYMENT_DUE_MINUTES = 15;

/* =====================================================
   TYPES
===================================================== */

export interface CabinAvailabilityResult {
  cabinId: string;
  available: boolean;
  requestedRange: { startDate: Date; endDate: Date };
  conflicts: Array<{
    bookingId: string;
    startDate: Date;
    endDate: Date;
    status: BookingStatus;
  }>;
  bookedRanges: Array<{
    startDate: Date;
    endDate: Date;
    status: BookingStatus;
  }>;
}

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
    private readonly bookingEvents: BookingEventPublisher,
  ) {}

  /* ─────────────────────────────────────────────────────
     PRIVATE — DATE HELPERS
  ───────────────────────────────────────────────────── */

  private toUtcDateOnly(value: string | Date): Date {
    const d = new Date(value);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private validateDates(start: Date, end: Date): void {
    const today = this.toUtcDateOnly(new Date());

    if (!isBefore(start, end)) {
      throw new BadRequestException('Check-out must be after check-in date');
    }

    if (isBefore(start, today)) {
      throw new BadRequestException('Check-in date cannot be in the past');
    }
  }

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

  private isBookingOwner(booking: Booking, userId: string): boolean {
    return booking.guestId.toString() === userId;
  }

  private isPrivileged(user: AuthUser): boolean {
    return user.role === UserRole.MANAGER;
  }

  private assertOwnerOrPrivileged(booking: Booking, user: AuthUser): void {
    if (!this.isBookingOwner(booking, user.sub) && !this.isPrivileged(user)) {
      throw new ForbiddenException('Access denied');
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — STATUS HELPERS
  ───────────────────────────────────────────────────── */

  private assertMutable(booking: Booking): void {
    if (TERMINAL_STATUSES.includes(booking.status)) {
      throw new BadRequestException(
        `Booking in status "${booking.status}" cannot be modified`,
      );
    }
  }

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

    return { cabinPrice, extrasPrice, totalPrice: cabinPrice + extrasPrice };
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — CONFLICT DETECTION
  ───────────────────────────────────────────────────── */

  /**
   * Date overlap:  existing.start < end  AND  existing.end > start
   * Status is the single source of truth — `active` flag is secondary.
   */
  private buildConflictFilter(
    start: Date,
    end: Date,
    excludeId?: string,
  ): Record<string, any> {
    const filter: Record<string, any> = {
      status: { $in: ACTIVE_BLOCKING_STATUSES },
      startDate: { $lt: end },
      endDate: { $gt: start },
    };

    if (excludeId) {
      filter._id = { $ne: new Types.ObjectId(excludeId) };
    }

    return filter;
  }

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
      .findOne({ ...baseFilter, cabinId: new Types.ObjectId(cabinId) })
      .session(session);

    if (cabinConflict) {
      throw new ConflictException('Cabin already booked for selected dates');
    }

    const guestConflict = await this.bookingModel
      .findOne({ ...baseFilter, guestId: new Types.ObjectId(guestId) })
      .session(session);

    if (guestConflict) {
      throw new ConflictException(
        'You already have another booking in this date range',
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — LOOKUP HELPERS
  ───────────────────────────────────────────────────── */

  private ensureValidObjectId(id: string, field: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${field} is invalid`);
    }

    return new Types.ObjectId(id);
  }

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

  async autoExpirePendingBookings(options?: {
    session?: ClientSession;
    force?: boolean;
  }): Promise<void> {
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
    const session = options?.session;

    const expiredBookings = await this.bookingModel
      .find(
        {
          status: BookingStatus.PENDING,
          paymentDueAt: { $lt: now },
          active: true,
        },
        null,
        { session },
      )
      .select('_id guestId cabinId')
      .lean();

    if (!expiredBookings.length) return;

    await this.bookingModel.updateMany(
      { _id: { $in: expiredBookings.map((b) => b._id) } },
      {
        $set: { status: BookingStatus.EXPIRED, active: false, expiredAt: now },
      },
      { session },
    );

    for (const booking of expiredBookings) {
      this.bookingEvents.expired(
        booking.id.toString(),
        booking.guestId.toString(),
        booking.cabinId.toString(),
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     CREATE
  ───────────────────────────────────────────────────── */

  async create(input: CreateBookingInput, guestId: string): Promise<Booking> {
    return this.withTransaction(async (session) => {
      const { cabinId, startDate, endDate, numGuests, hasBreakfast } = input;

      const start = this.toUtcDateOnly(startDate);
      const end = this.toUtcDateOnly(endDate);

      this.validateDates(start, end);

      await this.autoExpirePendingBookings({ session });

      const cabin = await this.findCabinOrFail(cabinId, session);
      const user = await this.findUserOrFail(guestId, session);

      if (numGuests > cabin.maxCapacity) {
        throw new BadRequestException(
          `This cabin allows a maximum of ${cabin.maxCapacity} guests`,
        );
      }

      await this.assertNoConflicts({ cabinId, guestId, start, end, session });

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
            guestId: user.id,
            cabinId: cabin._id,
            cabinName: cabin.name,
            startDate: start,
            endDate: end,
            numGuests,
            hasBreakfast,
            numNights: nights,
            ...prices,
            status: BookingStatus.PENDING,
            active: true,
            // FIX 4: Magic number replaced with named constant
            paymentDueAt: new Date(
              Date.now() + PAYMENT_DUE_MINUTES * 60 * 1000,
            ),
          },
        ],
        { session },
      );
      this.bookingEvents.created({
        bookingId: booking.id.toString(),
        userId: guestId.toString(),
        cabinName: booking.cabinName,
        startDate: booking.startDate.toISOString().split('T')[0],
        endDate: booking.endDate.toISOString().split('T')[0],
        totalPrice: booking.totalPrice,
      });
      return booking;
    });
  }

  /* ─────────────────────────────────────────────────────
     READ — SINGLE
  ───────────────────────────────────────────────────── */

  async findOne(id: string, user: AuthUser): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    if (!this.isPrivileged(user) && !this.isBookingOwner(booking, user.sub)) {
      throw new ForbiddenException('Access denied');
    }

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     READ — MY BOOKINGS
  ───────────────────────────────────────────────────── */

  async findMyBookings(user: AuthUser): Promise<BookingListResponse> {
    const guestId =
      typeof user.sub === 'string' ? new Types.ObjectId(user.sub) : user.sub;

    const bookings = await this.bookingModel
      .find({ guestId })
      .sort({ createdAt: -1 });

    return { status: 200, message: 'success', data: bookings };
  }

  /* ─────────────────────────────────────────────────────
     READ — ALL (MANAGER)
  ───────────────────────────────────────────────────── */

  async findAll(query: BookingQueryInput): Promise<PaginatedResult<Booking>> {
    await this.autoExpirePendingBookings();

    return buildQuery(this.bookingModel, query, {
      defaultSort: 'createdAt',
      skipFields: ['guestId', 'cabinId', 'startDate', 'endDate'],
      customFilter: (q) => {
        const filter: Record<string, any> = {};

        if (q.guestId) filter.guestId = new Types.ObjectId(q.guestId);
        if (q.cabinId) filter.cabinId = new Types.ObjectId(q.cabinId);

        if (q.startDate && q.endDate) {
          filter.startDate = { $lt: new Date(q.endDate) };
          filter.endDate = { $gt: new Date(q.startDate) };
        }

        return filter;
      },
    });
  }

  /* ─────────────────────────────────────────────────────
     UPDATE
  ───────────────────────────────────────────────────── */

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

  async cancelBooking(
    id: string,
    user: AuthUser,
    reason?: string,
  ): Promise<Booking> {
    return this.withTransaction(async (session) => {
      const booking = await this.findBookingOrFail(id, session);

      this.assertOwnerOrPrivileged(booking, user);

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
      booking.cancelledBy = new Types.ObjectId(user.sub);

      await booking.save({ session });
      this.bookingEvents.cancelled({
        bookingId: booking._id.toString(),
        userId: booking.guestId.toString(),
        cabinName: booking.cabinName,
        reason: booking.cancelReason,
      });
      return booking;
    });
  }

  /* ─────────────────────────────────────────────────────
     CONFIRM PAYMENT
  ───────────────────────────────────────────────────── */

  /**
   * checks if paymentDueAt has already passed before confirming.
   */
  async confirmBooking(id: string): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be confirmed');
    }

    if (booking.paymentDueAt && booking.paymentDueAt < new Date()) {
      // Expire it on the spot instead of confirming a ghost booking
      booking.status = BookingStatus.EXPIRED;
      booking.active = false;
      await booking.save();

      throw new BadRequestException(
        'Payment window has expired — booking has been cancelled automatically',
      );
    }

    booking.status = BookingStatus.CONFIRMED;
    booking.isPaid = true;
    booking.paymentStatus = PaymentStatus.PAID;
    await booking.save();

    this.bookingEvents.confirmed({
      bookingId: booking.id.toString(),
      userId: booking.guestId.toString(),
      cabinName: booking.cabinName,
      startDate: booking.startDate.toISOString().split('T')[0],
    });
    return booking;
  }

  /* ─────────────────────────────────────────────────────
     CHECK IN
  ───────────────────────────────────────────────────── */

  async checkIn(id: string): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    this.assertStatus(booking, BookingStatus.CONFIRMED);

    const today = this.toUtcDateOnly(new Date());
    const checkInDay = this.toUtcDateOnly(booking.startDate);

    if (isBefore(today, checkInDay)) {
      throw new BadRequestException(
        `Check-in is not allowed before ${checkInDay.toISOString().split('T')[0]}`,
      );
    }

    booking.status = BookingStatus.CHECKED_IN;
    booking.checkedInAt = new Date();

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     CHECK OUT
  ───────────────────────────────────────────────────── */

  async checkOut(id: string): Promise<Booking> {
    const booking = await this.findBookingOrFail(id);

    this.assertStatus(booking, BookingStatus.CHECKED_IN);

    const today = this.toUtcDateOnly(new Date());
    const checkOutDay = this.toUtcDateOnly(booking.endDate);

    if (isBefore(today, checkOutDay)) {
      throw new BadRequestException(
        `Check-out is not allowed before ${checkOutDay.toISOString().split('T')[0]}`,
      );
    }

    booking.status = BookingStatus.CHECKED_OUT;
    booking.active = false;
    booking.checkedOutAt = new Date();

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     MARK NO-SHOW
  ───────────────────────────────────────────────────── */

  async markNoShow(id: string, user: AuthUser): Promise<Booking> {
    const canMark = this.isPrivileged(user) || user.role === UserRole.EMPLOYEE;

    if (!canMark) {
      throw new ForbiddenException('Only staff can mark a no-show');
    }

    const booking = await this.findBookingOrFail(id);

    this.assertStatus(booking, BookingStatus.CONFIRMED);
    if (isBefore(booking.endDate, new Date())) {
      throw new BadRequestException(
        'cannot mark no show before locked end date',
      );
    }
    booking.status = BookingStatus.NO_SHOW;
    booking.active = false;

    await booking.save();

    return booking;
  }

  /* ─────────────────────────────────────────────────────
     CHECK CABIN AVAILABILITY  ← NEW
  ───────────────────────────────────────────────────── */

  /**
   * Checks whether a cabin is available for a given date range.
   *
   * Returns:
   * - `available`     — true if the range has zero blocking conflicts
   * - `conflicts`     — bookings that directly overlap the requested range
   * - `bookedRanges`  — ALL booked ranges for the cabin in the window
   *                     (useful for calendar UIs to render unavailable dates)
   *
   * Flow:
   * 1. Validate IDs and dates
   * 2. Assert cabin exists
   * 3. Expire any stale pending holds
   * 4. Query for conflicts in the range
   * 5. Query for all booked ranges in the same window (for the calendar)
   *
   * @param cabinId   Cabin to check
   * @param startDate Check-in date (string or Date)
   * @param endDate   Check-out date (string or Date)
   */
  async checkCabinAvailability(
    cabinId: string,
    startDate: string | Date,
    endDate: string | Date,
  ): Promise<CabinAvailabilityResult> {
    // 1. Validate ObjectId
    this.ensureValidObjectId(cabinId, 'Cabin ID');

    const start = this.toUtcDateOnly(startDate);
    const end = this.toUtcDateOnly(endDate);

    // 2. Validate date range
    this.validateDates(start, end);

    // 3. Assert cabin exists
    await this.findCabinOrFail(cabinId);

    // 4. Expire stale holds so they don't pollute results
    await this.autoExpirePendingBookings();

    const conflictFilter = this.buildConflictFilter(start, end);

    // 5. Conflicts — bookings that overlap the requested range
    const conflicts = await this.bookingModel
      .find({ ...conflictFilter, cabinId: new Types.ObjectId(cabinId) })
      .select('_id startDate endDate status')
      .lean();

    // 6. All booked ranges in the same window (for calendar rendering)
    //    Uses a wider query: any booking that overlaps this window at all.
    const bookedRanges = await this.bookingModel
      .find({
        cabinId: new Types.ObjectId(cabinId),
        status: { $in: ACTIVE_BLOCKING_STATUSES },
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .select('startDate endDate status')
      .lean();

    return {
      cabinId,
      available: conflicts.length === 0,
      requestedRange: { startDate: start, endDate: end },
      conflicts: conflicts.map((c) => ({
        bookingId: c._id.toString(),
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
      })),
      bookedRanges: bookedRanges.map((r) => ({
        startDate: r.startDate,
        endDate: r.endDate,
        status: r.status,
      })),
    };
  }
}
