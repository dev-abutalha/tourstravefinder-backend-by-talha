import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * FAQ (CPT `faq`) and its category taxonomy (`faq_category`).
 */
const faqSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['publish', 'draft'], default: 'publish', index: true },
    content: { type: String, default: '' },
    excerpt: { type: String, default: '' },
    categoryIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    order: { type: Number, default: 0 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export type FaqAttrs = InferSchemaType<typeof faqSchema>;
export type FaqDoc = HydratedDocument<FaqAttrs>;
export const Faq: Model<FaqAttrs> = model<FaqAttrs>('Faq', faqSchema);

const faqCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    parentId: { type: Schema.Types.ObjectId, default: null, index: true },
    description: { type: String, default: '' },
    order: { type: Number, default: 0 },
    faqCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type FaqCategoryAttrs = InferSchemaType<typeof faqCategorySchema>;
export type FaqCategoryDoc = HydratedDocument<FaqCategoryAttrs>;
export const FaqCategory: Model<FaqCategoryAttrs> = model<FaqCategoryAttrs>('FaqCategory', faqCategorySchema);

/**
 * A single entry inside a Top Destination / Top Attractions repeater.
 */
const showcaseItemSchema = new Schema(
  {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    link: { type: String, default: '' },
    /** Matches the WP taxonomy term title used to associate a page. */
    pageTitle: { type: String, default: '' },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * CPT `top_destinations` and `top_attractions`.
 * Both share an identical repeater structure, so they live in one collection
 * discriminated by `kind`.
 */
const showcaseSchema = new Schema(
  {
    kind: { type: String, enum: ['destination', 'attraction'], required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['publish', 'draft'], default: 'publish', index: true },
    subtitle: { type: String, default: '' },
    description: { type: String, default: '' },
    items: { type: [showcaseItemSchema], default: [] },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

showcaseSchema.index({ kind: 1, status: 1 });

export type ShowcaseAttrs = InferSchemaType<typeof showcaseSchema>;
export type ShowcaseDoc = HydratedDocument<ShowcaseAttrs>;
export const Showcase: Model<ShowcaseAttrs> = model<ShowcaseAttrs>('Showcase', showcaseSchema);
