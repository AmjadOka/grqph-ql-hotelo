import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Cabin } from '../cabin.schema';

@ObjectType()
class CabinMeta {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}

@ObjectType()
export class CabinsResponse {
  @Field(() => [Cabin])
  data: Cabin[];

  @Field(() => CabinMeta)
  meta: CabinMeta;
}
