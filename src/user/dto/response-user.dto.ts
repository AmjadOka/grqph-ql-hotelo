import { ObjectType, Field, Int } from '@nestjs/graphql';
import { User } from '../user.schema';

@ObjectType()
class UserMeta {
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
export class UsersResponse {
  @Field(() => [User])
  data: User[];

  @Field(() => UserMeta)
  meta: UserMeta;
}
