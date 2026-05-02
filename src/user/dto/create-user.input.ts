import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
} from 'class-validator';
import { UserRole } from '../user.schema';

@InputType()
export class CreateUserInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @Field()
  @IsEmail()
  email: string;

  @Field()
  @MinLength(8)
  password: string;

  @Field(() => UserRole, { defaultValue: UserRole.GUEST })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  avatar?: string;
}

@InputType()
export class UserQueryInput {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => UserRole, { nullable: true })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @Field({ nullable: true })
  @IsOptional()
  sortBy?: string = 'createdAt';

  @Field({ nullable: true })
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @Field({ nullable: true })
  @IsOptional()
  active: boolean;
}
