import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** Audit trail for the fraud shield - one row per scoring event. */
const fraudEventSchema = new Schema(
  {
    eventType: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, default: 'allowed' },
    riskScore: { type: Number, default: 0 },
    ipHash: { type: String, default: '' },
    emailHash: { type: String, default: '' },
    phoneHash: { type: String, default: '' },
    fingerprintHash: { type: String, default: '' },
    productKeys: { type: [String], default: [] },
    reasons: { type: [String], default: [] },
    context: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

fraudEventSchema.index({ createdAt: -1 });

export type FraudEventAttrs = InferSchemaType<typeof fraudEventSchema>;
export type FraudEventDoc = HydratedDocument<FraudEventAttrs>;
export const FraudEvent: Model<FraudEventAttrs> = model<FraudEventAttrs>('FraudEvent', fraudEventSchema);

/**
 * Lightweight key/value store for every `ttf_*` option and the aggregated
 * `ttf_fraud_settings` blob.
 */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: null },
    group: { type: String, default: 'general', index: true },
    label: { type: String, default: '' },
    type: { type: String, default: 'string' },
    description: { type: String, default: '' },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type SettingAttrs = InferSchemaType<typeof settingSchema>;
export type SettingDoc = HydratedDocument<SettingAttrs>;
export const Setting: Model<SettingAttrs> = model<SettingAttrs>('Setting', settingSchema);

/** Server-side cart, replacing the WooCommerce session cart. */
const cartSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    items: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            productTitle: String,
            productSlug: String,
            optionIndex: { type: Number, default: 0 },
            optionName: { type: String, default: '' },
            details: { type: String, default: '' },
            duration: { type: String, default: '' },
            date: { type: String, default: '' },
            time: { type: String, default: '' },
            language: { type: String, default: '' },
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
            priceBreakdown: { type: Schema.Types.Mixed, default: {} },
            addedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    couponCode: { type: String, default: '' },
    extras: {
      type: [
        new Schema({ id: String, label: String, price: Number }, { _id: false }),
      ],
      default: [],
    },
    travelerCount: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type CartAttrs = InferSchemaType<typeof cartSchema>;
export type CartDoc = HydratedDocument<CartAttrs>;
export const Cart: Model<CartAttrs> = model<CartAttrs>('Cart', cartSchema);

/** Coupon (mirrors WooCommerce coupon behaviour used by checkout). */
const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    type: { type: String, enum: ['fixed_cart', 'percent', 'fixed_product'], default: 'fixed_cart' },
    amount: { type: Number, default: 0 },
    description: { type: String, default: '' },
    dateExpires: Date,
    usageCount: { type: Number, default: 0 },
    usageLimit: { type: Number, default: 0 },
    usageLimitPerUser: { type: Number, default: 0 },
    minimumAmount: { type: Number, default: 0 },
    maximumAmount: { type: Number, default: 0 },
    individualUse: { type: Boolean, default: false },
    excludeSaleItems: { type: Boolean, default: false },
    freeShipping: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export type CouponAttrs = InferSchemaType<typeof couponSchema>;
export type CouponDoc = HydratedDocument<CouponAttrs>;
export const Coupon: Model<CouponAttrs> = model<CouponAttrs>('Coupon', couponSchema);

/** Uploaded media (product images, ticket files, gallery assets). */
const mediaSchema = new Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },
    url: { type: String, required: true },
    path: { type: String, required: true },
    width: Number,
    height: Number,
    alt: { type: String, default: '' },
    isSecure: { type: Boolean, default: false },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export type MediaAttrs = InferSchemaType<typeof mediaSchema>;
export type MediaDoc = HydratedDocument<MediaAttrs>;
export const Media: Model<MediaAttrs> = model<MediaAttrs>('Media', mediaSchema);

/** Contact-form submissions and newsletter signups. */
const messageSchema = new Schema(
  {
    type: { type: String, enum: ['contact', 'newsletter'], default: 'contact', index: true },
    name: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true, index: true },
    subject: { type: String, default: '' },
    message: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: {} },
    handled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type MessageAttrs = InferSchemaType<typeof messageSchema>;
export type MessageDoc = HydratedDocument<MessageAttrs>;
export const Message: Model<MessageAttrs> = model<MessageAttrs>('Message', messageSchema);
