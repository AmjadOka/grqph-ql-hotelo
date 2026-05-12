import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../notification.schema';
import { User } from 'src/user/user.schema';
import { BookingExpiredEvent } from '../events/booking-expired.event';

export interface UserRegisteredEvent {
  userId: string;
  email: string;
  fullName: string;
}

export interface BookingCreatedPayload {
  bookingId: string;
  userId: string;
  cabinName: string;
  startDate: string;
  endDate: string;
  totalPrice: number;
}

export interface BookingConfirmedPayload {
  bookingId: string;
  userId: string;
  cabinName: string;
  startDate: string;
}

export interface BookingCancelledPayload {
  bookingId: string;
  userId: string;
  cabinName: string;
  reason?: string;
}

/* ──────────────────────────────────────────────────────
   Listener
────────────────────────────────────────────────────── */

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly notifications: NotificationService,

    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  /* ─────────────────────────────────────────────────────
     AUTH EVENTS
  ───────────────────────────────────────────────────── */

  @OnEvent('user.registered')
  async onUserRegistered(event: UserRegisteredEvent): Promise<void> {
    try {
      await this.notifications.send(
        {
          userId: event.userId,
          type: NotificationType.WELCOME,
          to: event.email,
          subject: '👋 Welcome to the hotel',
          templateId: 'welcome',
          templateData: {
            name: event.fullName,
            exploreLink: `${process.env.CLIENT_URL}/cabins`,
          },
        },
        {
          userId: event.userId,
          type: NotificationType.WELCOME,
          title: 'Welcome!',
          body: 'Your account is ready. Browse our cabins and make your first booking.',
          link: '/cabins',
        },
      );
    } catch (err) {
      this.logger.error(
        `onUserRegistered failed for booking=${event.userId}`,
        err,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     EXPIRED  (already existed — now sends notification)
  ───────────────────────────────────────────────────── */

  @OnEvent('booking.expired')
  async handleBookingExpired(event: BookingExpiredEvent): Promise<void> {
    this.logger.debug(
      `Booking expired: ${event.bookingId} (guest: ${event.guestId})`,
    );

    try {
      const user = await this.resolveUser(event.guestId);
      if (!user) return;

      await this.notifications.send(
        {
          userId: event.guestId,
          type: NotificationType.BOOKING_EXPIRED,
          to: user.email,
          subject: '⏰ Your booking has expired',
          templateId: 'booking-expired',
          templateData: {
            name: user.fullName,
            retryLink: `${process.env.CLIENT_URL}/cabins`,
          },
        },
        {
          userId: event.guestId,
          type: NotificationType.BOOKING_EXPIRED,
          title: 'Booking expired',
          body: 'Your booking was not paid in time and has been released.',
          link: '/cabins',
        },
      );
    } catch (err) {
      this.logger.error(
        `handleBookingExpired failed for booking=${event.bookingId}`,
        err,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     CREATED
  ───────────────────────────────────────────────────── */

  @OnEvent('booking.created', { async: true })
  async handleBookingCreated(event: BookingCreatedPayload): Promise<void> {
    this.logger.debug(`Booking created: ${event.bookingId}`);

    try {
      const user = await this.resolveUser(event.userId);
      console.log(user, 'iiiuhn');
      if (!user) return;

      await this.notifications.send(
        {
          userId: event.userId,
          type: NotificationType.BOOKING_CREATED,
          to: user.email,
          subject: '📋 Booking received — complete your payment',
          templateId: 'booking-created',
          templateData: {
            name: user.fullName,
            cabinName: event.cabinName,
            startDate: event.startDate,
            endDate: event.endDate,
            totalPrice: event.totalPrice,
            paymentLink: `${process.env.CLIENT_URL}/bookings/${event.bookingId}/pay`,
          },
        },
        {
          userId: event.userId,
          type: NotificationType.BOOKING_CREATED,
          title: 'Booking received',
          body: `Your booking for ${event.cabinName} is pending payment.`,
          link: `/bookings/${event.bookingId}`,
        },
      );
    } catch (err) {
      this.logger.error(
        `handleBookingCreated failed for booking=${event.bookingId}`,
        err,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     CONFIRMED
  ───────────────────────────────────────────────────── */

  @OnEvent('booking.confirmed', { async: true })
  async handleBookingConfirmed(event: BookingConfirmedPayload): Promise<void> {
    this.logger.debug(`Booking confirmed: ${event.bookingId}`);
    try {
      const user = await this.resolveUser(event.userId);
      if (!user) return;

      await this.notifications.send(
        {
          userId: event.userId,
          type: NotificationType.BOOKING_CONFIRMED,
          to: user.email,
          subject: '✅ Booking confirmed!',
          templateId: 'booking-confirmed',
          templateData: {
            name: user.fullName,
            cabinName: event.cabinName,
            startDate: event.startDate,
            detailLink: `${process.env.CLIENT_URL}/bookings/${event.bookingId}`,
          },
        },
        {
          userId: event.userId,
          type: NotificationType.BOOKING_CONFIRMED,
          title: 'Booking confirmed',
          body: `Your stay at ${event.cabinName} is confirmed. See you on ${event.startDate}!`,
          link: `/bookings/${event.bookingId}`,
        },
      );
    } catch (err) {
      this.logger.error(
        `handleBookingConfirmed failed for booking=${event.bookingId}`,
        err,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     CANCELLED
  ───────────────────────────────────────────────────── */

  @OnEvent('booking.cancelled', { async: true })
  async handleBookingCancelled(event: BookingCancelledPayload): Promise<void> {
    this.logger.debug(`Booking cancelled: ${event.bookingId}`);
    try {
      const user = await this.resolveUser(event.userId);
      console.log(user, 'iii33hn');

      if (!user) return;

      await this.notifications.send(
        {
          userId: event.userId,
          type: NotificationType.BOOKING_CANCELLED,
          to: user.email,
          subject: '❌ Booking cancelled',
          templateId: 'booking-cancelled',
          templateData: {
            name: user.fullName,
            cabinName: event.cabinName,
            reason: event.reason ?? 'No reason provided',
          },
        },
        {
          userId: event.userId,
          type: NotificationType.BOOKING_CANCELLED,
          title: 'Booking cancelled',
          body: `Your booking for ${event.cabinName} was cancelled.`,
          link: `/bookings/${event.bookingId}`,
        },
      );
    } catch (err) {
      this.logger.error(
        `handleBookingCancelled failed for booking=${event.bookingId}`,
        err,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE
  ───────────────────────────────────────────────────── */

  /**
   * Fetches email + fullName for a user, logs a warning if not found.
   * Returning null lets each handler bail out cleanly without throwing.
   */
  private async resolveUser(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('email fullName')
      .lean();

    if (!user) {
      this.logger.warn(`BookingListener: user not found — ${userId}`);
    }

    return user ?? null;
  }
}
