import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Review } from '../review.schema';

/* =====================================================
   PAGINATION META
===================================================== */

@ObjectType()
export class ReviewMeta {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}

/* =====================================================
   PAGINATED DATA WRAPPER
===================================================== */

@ObjectType()
class ReviewPaginatedData {
  @Field(() => [Review])
  data: Review[];

  @Field(() => ReviewMeta)
  meta: ReviewMeta;
}

/* =====================================================
   RESPONSES 
===================================================== */

@ObjectType()
export class ReviewListResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field(() => ReviewPaginatedData)
  data: ReviewPaginatedData;
}

@ObjectType()
export class ReviewResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field(() => Review, { nullable: true })
  data?: Review;
}

@ObjectType()
export class DeleteReviewResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field()
  success: boolean;
}
