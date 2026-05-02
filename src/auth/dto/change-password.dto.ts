import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

@InputType()
export class ResetPasswordInput {
  @Field()
  @IsEmail({}, { message: 'A valid email is required to reset password' })
  @IsNotEmpty()
  email: string;
}

@InputType()
export class VerifyCodeInput {
  @Field()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @Field()
  @IsString()
  @Length(6, 6, { message: 'Verification code must be exactly 6 digits' })
  @IsNotEmpty()
  code: string;
}

@InputType()
export class ChangePasswordInput {
  @Field()
  @IsEmail({}, { message: 'A valid email is required to reset password' })
  @IsNotEmpty()
  email: string;

  @Field()
  @IsString()
  @Length(6, 20, { message: 'Password must be between 6 and 20 characters' })
  @IsNotEmpty()
  newPassword: string;
}
