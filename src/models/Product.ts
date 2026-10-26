import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export const TRAVELER_CATEGORIES = ['Adult', 'Child', 'Infant', 'Youth', 'Senior'] as const;
export type TravelerCategory = (typeof TRAVELER_CATEGORIES)[number];

export const PRICE_FORMULA = 'price = buying_price + service_charge + (service_charge * tax / 100)';

/** Per-traveler-category pricing row inside a booking option. */
const priceSchema = new Schema(
  {
    category: { type: String, enum: TRAVELER_CATEGORIES, required: true },
    ageFrom: { type: Number, default: 0 },
    ageTo: { type: Number, default: 0 },
    buyingPrice: { type: Number, default: 0, min: 0 },
    serviceCharge: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/** A bookable "option" (ticket type / package) on a product. */
const productOptionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    details: { type: String, default: '' },
    type: { type: String, default: 'Single Day', trim: true },
    capacity: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: false },
    startDate: { type: String, default: '' }, // YYYY-MM-DD
    endDate: { type: String, default: '' }, // YYYY-MM-DD
    repeat: {
      type: [String],
      default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
    startTime: { type: [String], default: [] }, // HH:MM
    prices: { type: [priceSchema], default: [] },
    lastDays: {
      days: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
    },
    duration: { type: String, default: '' },
    cutoff: { type: Number, default: 0 },
    languages: { type: [String], default: [] },
  },
  { _id: false },
);

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    alt: { type: String, default: '' },
    width: Number,
    height: Number,
  },
  { _id: false },
);

const ratingSchema = new Schema(
  {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    rated: { type: Number, default: 0 },
    counts: {
      type: new Schema(
        { 1: Number, 2: Number, 3: Number, 4: Number, 5: Number },
        { _id: false },
      ),
      default: () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }),
    },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    sku: { type: String, trim: true, index: true },
    status: { type: String, enum: ['publish', 'draft', 'pending', 'private'], default: 'publish', index: true },
    type: { type: String, enum: ['simple', 'variable', 'external', 'grouped'], default: 'simple' },

    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' }, // rich HTML
    content: { type: String, default: '' }, // long rich HTML

    price: { type: Number, default: 0 },
    regularPrice: { type: Number, default: 0 },
    salePrice: { type: Number, default: 0 },
    onSale: { type: Boolean, default: false },
    currency: { type: String, default: 'EUR' },

    images: { type: [imageSchema], default: [] },
    gallery: { type: [String], default: [] },

    categoryIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    tagIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    activityTypeIds: { type: [Schema.Types.ObjectId], default: [] },

    /** Booking engine --------------------------------------------------- */
    productOptions: { type: [productOptionSchema], default: [] },
    /** optionIndex -> YYYY-MM-DD -> [HH:MM] */
    unavailableSlots: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    /** optionIndex -> YYYY-MM-DD -> HH:MM -> remaining qty (0 = unlimited) */
    slotQuantities: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    passportRequirement: { type: String, enum: ['none', 'single', 'all'], default: 'none' },

    /** Presentation meta ------------------------------------------------ */
    keyPoints: {
      cancellationPolicy: { type: String, default: '' },
      duration: { type: String, default: '' },
      lastMinuteAvailability: { type: String, default: '' },
      wheelchairAccessible: { type: String, default: '' },
      skipTheLine: { type: String, default: '' },
      guideType: { type: String, default: '' },
      highlights: { type: [String], default: [] },
    },
    importantInformation: {
      title: { type: String, default: '' },
      content: { type: String, default: '' },
    },
    liveTourGuide: {
      title: { type: String, default: '' },
      content: { type: String, default: '' },
    },
    trekksoftButtonLink: { type: String, default: '' },
    highlightedText: { type: String, default: '' },
    highlightedQuantityText: { type: String, default: '' },

    rating: { type: ratingSchema, default: () => ({}) },
    bookingCount: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
    attributes: { type: [Schema.Types.Mixed], default: [] },

    seo: {
      title: String,
      description: String,
      focusKeyword: String,
      canonical: String,
      noIndex: { type: Boolean, default: false },
    },

    order: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

productSchema.index({ title: 'text', shortDescription: 'text', description: 'text' });
productSchema.index({ status: 1, createdAt: -1 });


productSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret: Record<string, unknown>) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type ProductAttrs = InferSchemaType<typeof productSchema>;
export type ProductDoc = HydratedDocument<ProductAttrs>;
export const Product: Model<ProductAttrs> = model<ProductAttrs>('Product', productSchema);
export { productOptionSchema, priceSchema };
export type ProductOptionInput = {
  name: string;
  details?: string;
  type?: string;
  capacity?: number;
  active?: boolean;
  startDate?: string;
  endDate?: string;
  repeat?: string[];
  startTime?: string[];
  prices?: {
    category: string;
    ageFrom?: number;
    ageTo?: number;
    buyingPrice?: number;
    serviceCharge?: number;
    tax?: number;
    price?: number;
  }[];
  lastDays?: { days?: number; percent?: number };
  duration?: string;
  cutoff?: number;
  languages?: string[];
};
