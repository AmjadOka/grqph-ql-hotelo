import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsOptional, Min } from 'class-validator';

@InputType()
export class UpdateSettingsInput {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Min(1)
  minBookingLength?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Min(1)
  maxBookingLength?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Min(1)
  maxGuestsPerBooking?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @Min(0)
  breakfastPrice?: number;
}
