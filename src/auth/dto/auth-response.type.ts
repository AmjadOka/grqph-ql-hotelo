import { ObjectType, Field, Int } from '@nestjs/graphql';
import { User } from 'src/user/user.schema';
import type { SafeUser } from '../auth.types';

@ObjectType()
export class AuthResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;

  @Field({ nullable: true })
  accessToken?: string;

  @Field({ nullable: true })
  refreshToken: string;

  @Field(() => User, { nullable: true })
  data?: SafeUser;
}

@ObjectType()
export class MessageResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;
}
