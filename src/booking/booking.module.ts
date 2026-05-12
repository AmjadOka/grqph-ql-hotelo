import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingResolver } from './booking.resolver';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/user/user.schema';
import { Booking, BookingSchema } from './booking.schema';
import { Cabin, CabinSchema } from 'src/cabin/cabin.schema';
import { UserLoader } from './loaders/user.loader';
import { CabinLoader } from './loaders/cabin.loader';
import { BookingScheduler } from './booking.scheduler';
import { BookingEventPublisher } from 'src/notification/events/booking-event.publisher';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Cabin.name, schema: CabinSchema },
    ]),
    NotificationModule,
  ],
  providers: [
    BookingResolver,
    BookingService,
    UserLoader,
    CabinLoader,
    BookingScheduler,
    BookingEventPublisher,
  ],
})
export class BookingModule {}
