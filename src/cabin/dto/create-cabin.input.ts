import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

@InputType()
export class CreateCabinInput {
  @Field()
  @IsString({ message: 'Cabin name must be a string' })
  @IsNotEmpty({ message: 'Cabin name (e.g., "001") is required' })
  name: string;

  @Field(() => Int)
  @IsNumber({}, { message: 'Must be a number' })
  @Type(() => Number)
  @Min(1, { message: 'Capacity must be at least 1 guest' })
  @Max(20, { message: 'Capacity cannot exceed 20 guests' })
  @IsNotEmpty()
  maxCapacity: number;

  @Field(() => Float)
  @IsNumber({}, { message: 'Must be a number' })
  @Type(() => Number)
  @Min(1, { message: 'Price cannot be zero or negative' })
  @IsNotEmpty()
  regularPrice: number;

  @Field(() => Float, { nullable: true })
  @IsNumber({}, { message: 'Must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Discount cannot be negative' })
  @IsOptional()
  discount?: number;

  @Field()
  @IsString()
  @IsNotEmpty({ message: 'A description is required for the website' })
  description: string;

  @Field()
  @IsUrl({}, { message: 'Image must be a valid URL string' })
  @IsNotEmpty({ message: 'An image URL is required' })
  image: string;
}
