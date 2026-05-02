import { InputType, Field, Int, ID } from '@nestjs/graphql';

@InputType()
export class CreateReviewInput {
  @Field(() => ID)
  cabinId: string;

  @Field(() => Int)
  rating: number;

  @Field({ nullable: true })
  comment?: string;
}
