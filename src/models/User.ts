import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type UserRole = 'customer' | 'manager' | 'admin';

const addressSchema = new Schema(
  {
    label: { type: String, default: 'Home' },
    firstName: String,
    lastName: String,
    company: String,
    address1: String,
    address2: String,
    city: String,
    state: String,
    postcode: String,
    country: String,
    phone: String,
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    displayName: { type: String, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ['customer', 'manager', 'admin'], default: 'customer', index: true },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: Date,
    resetToken: { type: String, select: false },
    resetTokenExpires: Date,
    addresses: { type: [addressSchema], default: [] },
    billingAddress: { type: addressSchema },
    shippingAddress: { type: addressSchema },
    lastLoginAt: Date,
    loginCount: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },
    notes: String,
    avatar: String,
    locale: { type: String, default: 'en' },
    currency: { type: String, default: 'EUR' },
    marketingOptIn: { type: Boolean, default: false },
    source: String,
    utm: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

userSchema.index({ createdAt: -1 });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User: Model<UserAttrs> = model<UserAttrs>('User', userSchema);
