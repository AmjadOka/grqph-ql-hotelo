import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ObjectType, Field, registerEnumType, ID } from '@nestjs/graphql';
import { Document, Schema as MongooseSchema } from 'mongoose'; // Ensure MongooseSchema is imported

export enum UserRole {
  GUEST = 'GUEST',
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
}

// This allows us to use the enum in our GraphQL queries/mutations
registerEnumType(UserRole, { name: 'UserRole' });

@ObjectType()
@Schema({ timestamps: true })
export class User extends Document {
  @Field(() => ID)
  get id(): string {
    return this._id.toString();
  }
  @Field()
  @Prop({ type: String, required: true })
  fullName: string;

  @Field()
  @Prop({ type: String, required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ type: String, required: true }) // No @Field() - security: never expose password to GraphQL
  password: string;

  @Field(() => UserRole)
  @Prop({ type: String, enum: UserRole, default: UserRole.GUEST })
  role: UserRole;

  @Field({ nullable: true })
  @Prop({ type: String })
  gender?: string;

  @Field({ nullable: true })
  @Prop({ type: String })
  avatar?: string;

  @Field({ nullable: true })
  @Prop({ type: String })
  phoneNumber?: string;

  @Field({ nullable: true })
  @Prop({ type: String })
  address?: string;

  @Field()
  @Prop({ type: Boolean, default: true })
  active: boolean;

  avatarPublicId?: string; // Internal field for storing Cloudinary public ID (not exposed to GraphQL)

  refreshTokenHash?: string;
  resetAttempts?: number;
  resetLastSentAt?: Date;
  // Internal Mongoose fields for password reset (not exposed to GraphQL)
  @Prop({ type: String }) resetTokenHash?: string;
  @Prop({ type: String }) resetCode?: string;
  @Prop({ type: Date }) resetExpires?: Date;
  @Prop({ type: Boolean, default: false }) isResetVerified?: boolean;
}

export const UserSchema: MongooseSchema = SchemaFactory.createForClass(User);
