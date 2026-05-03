/* =====================================================
   booking-response.dto.ts
===================================================== */

import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Booking } from '../booking.schema';

@ObjectType()
export class BookingResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field(() => Booking)
  data: Booking;
}

@ObjectType()
class BookingMeta {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}

@ObjectType()
export class BookingListResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field(() => [Booking])
  data: Booking[];

  @Field(() => BookingMeta, { nullable: true })
  meta?: BookingMeta;
}

@ObjectType()
export class DeleteResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field(() => ID, { nullable: true })
  id?: string;
}
