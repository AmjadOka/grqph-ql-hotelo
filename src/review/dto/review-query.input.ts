import { InputType, Field, Int } from '@nestjs/graphql';
import { IsOptional, IsInt, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';
@InputType()
export class ReviewQueryInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @Field({ nullable: true })
  @IsOptional()
  sortBy?: string = 'createdAt';

  @Field({ nullable: true })
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
