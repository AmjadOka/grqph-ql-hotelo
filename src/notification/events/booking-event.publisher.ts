// common/events/booking-event.publisher.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingExpiredEvent } from './booking-expired.event';
import {
  BookingCancelledPayload,
  BookingConfirmedPayload,
  BookingCreatedPayload,
} from '../listeners/notification.listener';

export enum BookingEvents {
  CREATED = 'booking.created',
  CONFIRMED = 'booking.confirmed',
  CANCELLED = 'booking.cancelled',
  EXPIRED = 'booking.expired',
}

/**
 * BookingEventPublisher
 *
 * Mirrors ReviewEventPublisher — a thin injectable wrapper around
 * EventEmitter2 so BookingService never imports EventEmitter2 directly.
 *
 * Usage in BookingService:
 *   this.bookingEvents.confirmed({ bookingId, userId, cabinName, startDate });
 */
@Injectable()
export class BookingEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  created(payload: BookingCreatedPayload): void {
    this.emitter.emit(BookingEvents.CREATED, payload);
  }

  confirmed(payload: BookingConfirmedPayload): void {
    this.emitter.emit(BookingEvents.CONFIRMED, payload);
  }

  cancelled(payload: BookingCancelledPayload): void {
    this.emitter.emit(BookingEvents.CANCELLED, payload);
  }

  expired(bookingId: string, guestId: string, cabinId: string): void {
    this.emitter.emit(
      BookingEvents.EXPIRED,
      new BookingExpiredEvent(bookingId, guestId, cabinId),
    );
  }
}
