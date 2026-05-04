import { InputType, Field, Int, ID } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

@InputType()
export class UpdateReviewInput {
  @Field(() => ID)
  @IsMongoId({ message: 'The cabinId must be a valid MongoDB ObjectId' })
  @IsNotEmpty({ message: 'Cabin ID is required' })
  reviewId: string;

  @Field(() => Int)
  @IsNumber({}, { message: 'Must be a number' })
  @Type(() => Number)
  @Min(1, { message: 'Capacity must be at least 1 guest' })
  @Max(5, { message: 'Capacity cannot exceed 5 guests' })
  @IsNotEmpty()
  rating?: number;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  comment?: string;
}
