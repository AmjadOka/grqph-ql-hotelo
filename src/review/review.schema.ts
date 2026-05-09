import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Document, Types } from 'mongoose';
import { User } from '../user/user.schema';
import { Cabin } from '../cabin/cabin.schema';
import { Booking } from 'src/booking/booking.schema';

@ObjectType()
@Schema({ timestamps: true })
export class Review extends Document {
  @Field(() => ID)
  get id(): string {
    return this._id.toString();
  }
  /* =========================
     RELATIONS
  ========================= */

  @Field(() => ID)
  @Prop({
    type: Types.ObjectId,
    ref: Booking.name,
    required: true,
    index: true,
  })
  bookingId: Types.ObjectId;

  @Field(() => ID)
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId: Types.ObjectId;

  @Field(() => ID)
  @Prop({ type: Types.ObjectId, ref: Cabin.name, required: true, index: true })
  cabinId: Types.ObjectId;

  /* =========================
     REVIEW DATA
  ========================= */

  @Field(() => Int)
  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Field({ nullable: true })
  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  /* =========================
     FLAGS
  ========================= */

  @Field()
  @Prop({ default: false })
  isEdited: boolean;

  @Field({ nullable: true })
  @Prop()
  updatedAt?: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

ReviewSchema.index({ bookingId: 1 }, { unique: true });
ReviewSchema.index({ userId: 1, createdAt: -1 });
