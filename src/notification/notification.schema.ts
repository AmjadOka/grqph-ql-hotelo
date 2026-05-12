import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { User } from 'src/user/user.schema';

export enum NotificationType {
  BOOKING_CREATED = 'BOOKING_CREATED',
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  BOOKING_REMINDER = 'BOOKING_REMINDER',
  BOOKING_EXPIRED = 'BOOKING_EXPIRED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  WELCOME = 'WELCOME',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
}

registerEnumType(NotificationType, { name: 'NotificationType' });

@ObjectType()
@Schema({ timestamps: true })
export class Notification extends Document {
  get id(): string {
    return this._id.toString();
  }
  /** Owner of the notification */
  @Field(() => ID)
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId: Types.ObjectId;

  @Field(() => NotificationType)
  @Prop({ enum: NotificationType, required: true })
  type: NotificationType;

  @Field()
  @Prop({ required: true })
  title: string;

  @Field()
  @Prop({ required: true })
  body: string;

  /** False until user opens / marks read */
  @Field()
  @Prop({ default: false, index: true })
  read: boolean;

  /** Optional deep-link — e.g. /bookings/:id */
  @Field({ nullable: true })
  @Prop()
  link?: string;

  @Field()
  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Compound index: fast unread count per user
NotificationSchema.index({ userId: 1, read: 1 });
