import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingService } from './booking.service';

/**
 * BookingScheduler
 *
 * Handles all time-based booking tasks.
 * Runs independently of user requests — complements the lazy expiry
 * in BookingService so stale PENDING holds are cleaned up even during
 * periods of low traffic.
 */
@Injectable()
export class BookingScheduler {
  private readonly logger = new Logger(BookingScheduler.name);

  constructor(private readonly bookingService: BookingService) {}

  /**
   * Expires unpaid PENDING bookings every 5 minutes.
   *
   * Why 5 min and not 15?
   * The payment hold is 15 minutes, but running every 5 ensures
   * a worst-case expiry lag of only 5 min rather than 15.
   * Adjust the interval to match your traffic / SLA needs.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingBookings(): Promise<void> {
    this.logger.debug('Running pending booking expiry sweep...');

    try {
      await this.bookingService.autoExpirePendingBookings(true);
      this.logger.debug('Expiry sweep complete');
    } catch (err) {
      this.logger.error('Expiry sweep failed', err);
    }
  }
}
