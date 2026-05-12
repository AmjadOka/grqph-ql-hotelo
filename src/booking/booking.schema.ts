import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ObjectType,
  Field,
  registerEnumType,
  Int,
  Float,
  ID,
} from '@nestjs/graphql';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../user/user.schema';
import { Cabin } from '../cabin/cabin.schema';

/* =====================================================
   ENUMS
===================================================== */

export enum BookingStatus {
  PENDING = 'PENDING', // Created; awaiting payment
  CONFIRMED = 'CONFIRMED', // Payment received; reservation active
  CHECKED_IN = 'CHECKED_IN', // Guest has arrived
  CHECKED_OUT = 'CHECKED_OUT', // Stay completed

  CANCELLED_BY_GUEST = 'CANCELLED_BY_GUEST',
  CANCELLED_BY_ADMIN = 'CANCELLED_BY_ADMIN',
  CANCELLED_SYSTEM = 'CANCELLED_SYSTEM', // Timeout / fraud / payment failure

  NO_SHOW = 'NO_SHOW', // Guest never arrived
  EXPIRED = 'EXPIRED', // Unpaid payment hold elapsed
}

export enum PaymentStatus {
  UNPAID = 'UNPAID',
  AUTHORIZED = 'AUTHORIZED',
  PAID = 'PAID',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

registerEnumType(BookingStatus, {
  name: 'BookingStatus',
  description: 'Lifecycle status of a booking',
});

registerEnumType(PaymentStatus, {
  name: 'PaymentStatus',
  description: 'Payment state of a booking',
});

/* =====================================================
   SCHEMA / OBJECT TYPE
===================================================== */

/**
 * Booking
 *
 * Central entity representing a cabin reservation.
 *
 * Life-cycle (happy path):
 *   PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT
 *
 * Terminal states: CANCELLED_*, EXPIRED, NO_SHOW, CHECKED_OUT
 */
@ObjectType()
@Schema({ timestamps: true })
export class Booking extends Document {
  @Field(() => ID)
  get id(): string {
    return this._id.toString();
  }
  /* ─── Relations ──────────────────────────────────── */

  /** The cabin being reserved.  Resolved via CabinLoader in the resolver. */
  @Field(() => ID)
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Cabin.name,
    required: true,
  })
  cabinId: Types.ObjectId;

  @Field(() => Cabin, { nullable: true })
  cabin?: Cabin;

  @Field()
  @Prop({ required: true })
  cabinName: string;
  /** The guest who made the booking.  Resolved via UserLoader in the resolver. */
  @Field(() => ID)
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  guestId: Types.ObjectId;

  @Field(() => User, { nullable: true })
  guest?: User;

  /* ─── Dates ──────────────────────────────────────── */

  /** UTC midnight check-in date */
  @Field()
  @Prop({ type: Date, required: true })
  startDate: Date;

  /** UTC midnight check-out date */
  @Field()
  @Prop({ type: Date, required: true })
  endDate: Date;

  /* ─── Stay details ───────────────────────────────── */

  @Field(() => Int)
  @Prop({ type: Number, required: true, min: 1 })
  numNights: number;

  @Field(() => Int)
  @Prop({ type: Number, required: true, min: 1 })
  numGuests: number;

  @Field()
  @Prop({ type: Boolean, default: false })
  hasBreakfast: boolean;

  @Field({ nullable: true })
  @Prop()
  observations?: string;

  /* ─── Pricing ────────────────────────────────────── */

  /** Cabin cost only (nightly rate × nights) */
  @Field(() => Float)
  @Prop({ type: Number, required: true })
  cabinPrice: number;

  /** Additional charges (breakfast, etc.) */
  @Field(() => Float)
  @Prop({ type: Number, default: 0 })
  extrasPrice: number;

  /** Grand total (cabinPrice + extrasPrice) */
  @Field(() => Float)
  @Prop({ type: Number, required: true })
  totalPrice: number;

  /* ─── Status ─────────────────────────────────────── */

  @Field(() => BookingStatus)
  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING })
  status: BookingStatus;

  @Field(() => PaymentStatus)
  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.UNPAID })
  paymentStatus: PaymentStatus;

  @Field()
  @Prop({ type: Boolean, default: false })
  isPaid: boolean;

  /**
   * Indicates whether the booking is "live" (not cancelled / expired / checked-out).
   * Used as a quick filter for availability queries.
   */
  @Field()
  @Prop({ default: true })
  active: boolean;

  /* ─── Payment hold ───────────────────────────────── */

  /**
   * Timestamp by which payment must be received or the PENDING hold expires.
   * Set to `now + 15 min` on creation.  Indexed for efficient expiry sweeps.
   */
  @Field({ nullable: true })
  @Prop({ type: Date })
  paymentDueAt?: Date;

  /* ─── Cancellation metadata ──────────────────────── */

  @Field({ nullable: true })
  @Prop()
  cancelReason?: string;

  @Field({ nullable: true })
  @Prop({ type: Date })
  cancelledAt?: Date;

  @Field(() => ID, { nullable: true })
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  cancelledBy?: Types.ObjectId;

  /* ─── Lifecycle timestamps ───────────────────────── */

  @Field({ nullable: true })
  @Prop({ type: Date })
  checkedInAt?: Date;

  @Field({ nullable: true })
  @Prop({ type: Date })
  checkedOutAt?: Date;

  /** Set when an EXPIRED record is processed */
  @Field({ nullable: true })
  @Prop({ type: Date })
  expiredAt?: Date;

  /* ─── Auto timestamps (Mongoose) ─────────────────── */

  @Field()
  declare createdAt: Date;

  @Field()
  declare updatedAt: Date;
}

export const BookingSchema: MongooseSchema =
  SchemaFactory.createForClass(Booking);

/* =====================================================
   INDEXES
===================================================== */

/**
 * Compound indexes to accelerate the two most common query patterns:
 * 1. Availability check — "is this cabin free for these dates?"
 * 2. Guest conflict check — "does this guest have overlapping bookings?"
 *
 * Including `status` and `active` in the index reduces index scan size
 * when filtering for only blocking statuses.
 */
BookingSchema.index({ cabin: 1, startDate: 1, endDate: 1, status: 1 });
BookingSchema.index({ guest: 1, startDate: 1, endDate: 1, status: 1 });

/** Supports efficient expiry sweeps in `autoExpirePendingBookings` */
BookingSchema.index({ status: 1, paymentDueAt: 1, active: 1 });
