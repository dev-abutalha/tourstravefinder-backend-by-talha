import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Product review. Two flavours exist in the original theme:
 *  - `manual`  - inserted by an admin (WordPress comment with type `review`)
 *  - `customer`- submitted through the tokenised review form
 */
const reviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    authorName: { type: String, default: '' },
    authorEmail: { type: String, default: '', lowercase: true, trim: true },
    authorAvatar: { type: String, default: '' },
    rating: { type: Number, min: 1, max: 5, default: 5, index: true },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    status: { type: String, enum: ['approved', 'pending', 'spam', 'rejected'], default: 'approved', index: true },
    source: { type: String, enum: ['manual', 'customer'], default: 'customer' },
    verifiedBooking: { type: Boolean, default: false },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    images: { type: [String], default: [] },
    helpfulCount: { type: Number, default: 0 },
    ipHash: String,
    moderatedBy: String,
  },
  { timestamps: true },
);

reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });

export type ReviewAttrs = InferSchemaType<typeof reviewSchema>;
export type ReviewDoc = HydratedDocument<ReviewAttrs>;
export const Review: Model<ReviewAttrs> = model<ReviewAttrs>('Review', reviewSchema);

/** One-time token that lets a customer review an order. */
const reviewTokenSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, default: '' },
    used: { type: Boolean, default: false },
    usedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export type ReviewTokenAttrs = InferSchemaType<typeof reviewTokenSchema>;
export type ReviewTokenDoc = HydratedDocument<ReviewTokenAttrs>;
export const ReviewToken: Model<ReviewTokenAttrs> = model<ReviewTokenAttrs>('ReviewToken', reviewTokenSchema);
