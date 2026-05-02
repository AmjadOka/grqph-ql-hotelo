import { BookingStatus } from '../booking.schema';

export interface BookingFilters {
  cabinId?: string;
  guestId?: string;
  status?: BookingStatus;
  startDateFrom?: string;
  startDateTo?: string;
}
