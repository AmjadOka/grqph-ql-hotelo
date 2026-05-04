import { InputType, Field, Int } from '@nestjs/graphql';
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
export class CreateReviewInput {
  @Field(() => String)
  @IsMongoId({ message: 'The cabinId must be a valid MongoDB ObjectId' })
  @IsNotEmpty({ message: 'Cabin ID is required' })
  cabinId: string;

  @Field(() => Int)
  @IsNumber({}, { message: 'Must be a number' })
  @Type(() => Number)
  @Min(1, { message: 'Capacity must be at least 1 guest' })
  @Max(5, { message: 'Capacity cannot exceed 5 guests' })
  @IsNotEmpty()
  rating: number;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  comment: string;
}
