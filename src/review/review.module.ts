import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewResolver } from './review.resolver';
import { ReviewStatsListener } from 'src/notification/listeners/review-stats.listener';
import { MongooseModule } from '@nestjs/mongoose';
import { Review, ReviewSchema } from './review.schema';
import { Cabin, CabinSchema } from 'src/cabin/cabin.schema';
import { ReviewEventPublisher } from 'src/notification/events/review-event.publisher';
import { CabinStatsService } from 'src/notification/services/cabin-stats.service';
import { Booking, BookingSchema } from 'src/booking/booking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Cabin.name, schema: CabinSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  providers: [
    ReviewResolver,
    ReviewService,

    ReviewEventPublisher,
    CabinStatsService,
    ReviewStatsListener,
  ],
  exports: [ReviewService],
})
export class ReviewModule {}
