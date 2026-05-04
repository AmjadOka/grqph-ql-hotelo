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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Cabin.name, schema: CabinSchema },
    ]),
  ],
  providers: [
    BookingResolver,
    BookingService,
    UserLoader,
    CabinLoader,
    BookingScheduler,
  ],
})
export class BookingModule {}
