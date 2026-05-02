import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsDate,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsMongoId,
  Min,
  IsString,
  IsEnum,
} from 'class-validator';
import { BookingStatus } from '../booking.schema';

@InputType()
export class CreateBookingInput {
  @Field(() => String)
  @IsMongoId({ message: 'The cabinId must be a valid MongoDB ObjectId' })
  @IsNotEmpty({ message: 'Cabin ID is required' })
  cabinId: string;

  @Field()
  @IsDate({ message: 'startDate must be a valid Date object' })
  @IsNotEmpty({ message: 'Check-in date is required' })
  startDate: Date;

  @Field()
  @IsDate({ message: 'endDate must be a valid Date object' })
  @IsNotEmpty({ message: 'Check-out date is required' })
  endDate: Date;

  @Field(() => Int)
  @IsNumber()
  @Min(1, { message: 'There must be at least 1 guest' })
  @IsNotEmpty()
  numGuests: number;

  @Field({ defaultValue: false })
  @IsBoolean()
  @IsOptional()
  hasBreakfast?: boolean;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  observations?: string;
}

@InputType()
export class BookingQueryInput {
  // ─────────────────────────────
  // Pagination
  // ─────────────────────────────

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 10;

  // ─────────────────────────────
  // Search
  // ─────────────────────────────

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  search?: string;

  // ─────────────────────────────
  // Sorting
  // ─────────────────────────────

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @Field({ nullable: true, defaultValue: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';

  // ─────────────────────────────
  // Filters
  // ─────────────────────────────

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  cabinId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  guestId?: string;

  @Field(() => BookingStatus, { nullable: true })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  // ─────────────────────────────
  // Optional date filters
  // ─────────────────────────────

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  startDate?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  endDate?: string;
}
