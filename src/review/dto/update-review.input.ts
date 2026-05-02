import { InputType, Field, Int, ID } from '@nestjs/graphql';

@InputType()
export class UpdateReviewInput {
  @Field(() => ID)
  reviewId: string;

  @Field(() => Int, { nullable: true })
  rating?: number;

  @Field({ nullable: true })
  comment?: string;
}
