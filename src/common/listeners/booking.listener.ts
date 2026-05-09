// listeners/booking.listener.ts
import { OnEvent } from '@nestjs/event-emitter';
import { Injectable, Logger } from '@nestjs/common';
import { BookingExpiredEvent } from '../events/booking-expired.event';
@Injectable()
export class BookingListener {
  private readonly logger = new Logger(BookingListener.name);

  @OnEvent('booking.expired')
  async handleBookingExpired(event: BookingExpiredEvent) {
    this.logger.debug(
      `Booking expired: ${event.bookingId} (guest: ${event.guestId})`,
    );

    //  here you can:
    // - send email
    // - send push notification
    // - refund payment
    // - update analytics
  }
}
