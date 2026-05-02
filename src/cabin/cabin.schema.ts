import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@ObjectType()
@Schema({ timestamps: true })
export class Cabin extends Document {
  @Field(() => ID)
  declare _id: Types.ObjectId;

  @Field()
  @Prop({ type: String, required: true, unique: true, trim: true })
  name: string;

  @Field(() => Int)
  @Prop({ type: Number, required: true, min: 1 })
  maxCapacity: number;

  @Field(() => Float)
  @Prop({ type: Number, required: true, min: 0 })
  regularPrice: number;

  @Field(() => Float, { defaultValue: 0 })
  @Prop({ type: Number, default: 0, min: 0 })
  discount: number;

  @Field()
  @Prop({ type: String, required: true })
  image: string;

  @Field()
  @Prop({ type: String, required: true, trim: true })
  description: string;

  /** Denormalized average rating — updated via EventEmitter after every review mutation */
  @Field(() => Float, { defaultValue: 0 })
  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  ratingAvg: number;

  /** Total number of reviews — kept in sync with ratingAvg */
  @Field(() => Int, { defaultValue: 0 })
  @Prop({ type: Number, default: 0, min: 0 })
  ratingCount: number;
}

export const CabinSchema: MongooseSchema = SchemaFactory.createForClass(Cabin);
CabinSchema.index({ name: 'text', description: 'text' });
CabinSchema.index({ regularPrice: 1 });
CabinSchema.index({ maxCapacity: 1 });
CabinSchema.index({ ratingAvg: -1 });
