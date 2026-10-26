import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export const ORDER_STATUSES = [
  'pending',
  'processing',
  'on-hold',
  'booking-confirm',
  'completed',
  'cancelled',
  'refunded',
  'failed',
  'fraud-review',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['redsys', 'stripe', 'paypal', 'bank_transfer', 'cash', 'cod'] as const;

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productSlug: String,
    productTitle: String,
    productImage: String,
    /** Booking option snapshot */
    optionIndex: { type: Number, default: 0 },
    optionName: { type: String, default: '' },
    details: { type: String, default: '' },
    duration: { type: String, default: '' },
    date: { type: String, default: '' },
    time: { type: String, default: '' },
    language: { type: String, default: '' },
    /** Per-traveler-category counts */
    travelers: {
      type: new Schema(
        { Adult: Number, Child: Number, Infant: Number, Youth: Number, Senior: Number },
        { _id: false },
      ),
      default: () => ({ Adult: 1 }),
    },
    travelerCount: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    dynamicPrice: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    priceBreakdown: { type: Schema.Types.Mixed, default: {} },
    lineExtras: {
      type: [
        new Schema({ id: String, label: String, price: Number }, { _id: false }),
      ],
      default: [],
    },
  },
  { _id: true },
);

const passengerSchema = new Schema(
  {
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    passport: { type: String, default: '' },
    nationality: { type: String, default: '' },
    passportExpiry: { type: String, default: '' },
    birthDate: { type: String, default: '' },
    isLead: { type: Boolean, default: false },
  },
  { _id: false },
);

const fraudInfoSchema = new Schema(
  {
    level: { type: String, enum: ['allowed', 'review', 'blocked'], default: 'allowed' },
    score: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },
    reviewed: { type: Boolean, default: false },
    ip: String,
    ipHash: String,
    emailHash: String,
    phoneHash: String,
    fingerprint: String,
    fingerprintHash: String,
    fingerprintSource: String,
    productKeys: { type: [String], default: [] },
    sessionId: String,
    context: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    paymentStatus: { type: String, default: 'pending' },
    paymentMethod: { type: String, default: 'cod' },
    transactionId: String,
    currency: { type: String, default: 'EUR' },

    /** Totals */
    subtotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    feeTotal: { type: Number, default: 0 },
    shippingTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    refunds: { type: Number, default: 0 },

    items: { type: [orderItemSchema], default: [] },

    /** Customer */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    customerPhone: { type: String, default: '' },
    billing: {
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
      country: String,
      address1: String,
      address2: String,
      city: String,
      state: String,
      postcode: String,
      company: String,
    },
    shipping: { type: Schema.Types.Mixed, default: {} },

    /** Booking meta */
    travelerCount: { type: Number, default: 1 },
    passengers: { type: [passengerSchema], default: [] },
    extras: {
      type: [
        new Schema({ id: String, label: String, price: Number }, { _id: false }),
      ],
      default: [],
    },
    pickupOption: { type: String, default: '' },
    departureOption: { type: String, default: '' },
    couponCode: { type: String, default: '' },

    /** Tickets */
    ticketFiles: { type: [String], default: [] },
    ticketSentAt: Date,
    /** Slot inventory guard */
    slotsReduced: { type: Boolean, default: false },

    /** Cancellation */
    cancelRequested: { type: Boolean, default: false },
    cancelRequestedAt: Date,
    cancelReason: { type: String, default: '' },
    cancelResolvedAt: Date,
    cancelResolvedBy: { type: String, default: '' },

    /** Review request */
    reviewEnabled: { type: Boolean, default: false },
    reviewSentAt: Date,
    reviewToken: { type: String, default: '', index: true },

    /** Fraud shield */
    fraud: { type: fraudInfoSchema, default: () => ({}) },

    /** Attribution */
    attribution: {
      sourceType: { type: String, default: 'direct' },
      referrer: { type: String, default: '' },
      utmSource: { type: String, default: '' },
      utmMedium: { type: String, default: '' },
      utmCampaign: { type: String, default: '' },
      sessionEntry: { type: String, default: '' },
      sessionPages: { type: Number, default: 0 },
      deviceType: { type: String, default: 'desktop' },
    },

    notes: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'billing.email': 1 });

orderSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret: Record<string, unknown>) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type OrderAttrs = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<OrderAttrs>;
export const Order: Model<OrderAttrs> = model<OrderAttrs>('Order', orderSchema);
