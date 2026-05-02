import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import { Document, Schema as MongooseSchema, Types } from 'mongoose'; // Ensure MongooseSchema is imported

@ObjectType()
@Schema({ timestamps: true })
export class Settings extends Document {
  @Field(() => ID)
  declare _id: Types.ObjectId;

  @Field(() => Int)
  @Prop({ type: Number, required: true, default: 1 })
  minBookingLength: number;

  @Field(() => Int)
  @Prop({ type: Number, required: true, default: 90 })
  maxBookingLength: number;

  @Field(() => Int)
  @Prop({ type: Number, required: true, default: 10 })
  maxGuestsPerBooking: number;

  @Field(() => Float)
  @Prop({ type: Number, required: true, default: 15 })
  breakfastPrice: number;
}

export const SettingsSchema: MongooseSchema =
  SchemaFactory.createForClass(Settings);
