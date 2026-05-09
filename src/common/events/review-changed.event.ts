// common/events/review-changed.event.ts
export class ReviewChangedEvent {
  constructor(public readonly cabinId: string) {}

  static from(cabinId: string | { toString(): string }) {
    return new ReviewChangedEvent(cabinId.toString());
  }
}
