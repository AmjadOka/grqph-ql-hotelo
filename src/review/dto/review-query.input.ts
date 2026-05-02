import { InputType, Field, ID, Int } from '@nestjs/graphql';

@InputType()
export class ReviewQueryInput {
  @Field({ nullable: true })
  search?: string;

  @Field(() => ID, { nullable: true })
  cabinId?: string;

  @Field(() => ID, { nullable: true })
  userId?: string;

  @Field(() => Int, { nullable: true })
  page?: number;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field({ nullable: true })
  sortBy?: string;

  @Field({ nullable: true })
  sortOrder?: 'asc' | 'desc';
}
