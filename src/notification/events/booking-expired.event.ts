export class BookingExpiredEvent {
  constructor(
    public readonly bookingId: string,
    public readonly guestId: string,
    public readonly cabinId: string,
  ) {}
}
