// common/events/review-event.publisher.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReviewEvents } from './review.event';
import { ReviewChangedEvent } from './review-changed.event';

@Injectable()
export class ReviewEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  reviewChanged(cabinId: string | { toString(): string }) {
    this.emitter.emit(ReviewEvents.CHANGED, ReviewChangedEvent.from(cabinId));
  }
}
