import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Document, Types } from 'mongoose';
import { User } from '../user/user.schema';
import { Cabin } from '../cabin/cabin.schema';

@ObjectType()
@Schema({ timestamps: true })
export class Review extends Document {
  /* =========================
     RELATIONS
  ========================= */

  @Field(() => ID)
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  user: Types.ObjectId;

  @Field(() => ID)
  @Prop({ type: Types.ObjectId, ref: Cabin.name, required: true, index: true })
  cabin: Types.ObjectId;

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
  editedAt?: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// Compound unique: one review per user per cabin
ReviewSchema.index({ user: 1, cabin: 1 }, { unique: true });
ReviewSchema.index({ cabin: 1, createdAt: -1 });
ReviewSchema.index({ user: 1, createdAt: -1 });
ReviewSchema.index({ cabin: 1, rating: 1 });
