import { ObjectType, Field, Int } from '@nestjs/graphql';
import { UserRole } from 'src/user/user.schema';
@ObjectType()
class SafeUser {
  @Field()
  id: string;
  @Field()
  email: string;
  @Field()
  fullName: string;
  @Field(() => UserRole)
  role: UserRole;
  @Field()
  avatar: string;
  @Field()
  active: boolean;
}

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

  @Field(() => SafeUser, { nullable: true })
  data?: SafeUser;
}

@ObjectType()
export class MessageResponse {
  @Field(() => Int)
  status: number;

  @Field()
  message: string;
}
