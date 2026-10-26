import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * A product category (WordPress `product_cat`).
 * `categoryType` drives the mega-menu grouping and the "Things to do"
 * / "Top attractions" flags replace the original term meta flags.
 */
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    description: { type: String, default: '' },
    /** '' | country | city | attraction */
    categoryType: { type: String, default: '', enum: ['', 'country', 'city', 'attraction'] },
    /** Custom link override (WP term meta `category_page_link`) */
    categoryPageLink: { type: String, default: '' },
    /** WP term meta `top_experience` - surfaces in "Things to do" */
    topExperience: { type: Boolean, default: false, index: true },
    /** WP term meta `top_attraction` - surfaces in "Top attractions" */
    topAttraction: { type: Boolean, default: false, index: true },
    image: { type: String, default: '' },
    icon: { type: String, default: '' },
    productCount: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    meta: { type: Schema.Types.Mixed, default: {} },
    seo: {
      title: String,
      description: String,
    },
  },
  { timestamps: true },
);

categorySchema.index({ name: 'text', description: 'text' });
categorySchema.index({ parentId: 1, order: 1 });

export type CategoryAttrs = InferSchemaType<typeof categorySchema>;
export type CategoryDoc = HydratedDocument<CategoryAttrs>;
export const Category: Model<CategoryAttrs> = model<CategoryAttrs>('Category', categorySchema);

/** Generic taxonomy used for product tags and activity types. */
const taxonomySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    kind: { type: String, enum: ['product_tag', 'activity_type'], required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, default: null, index: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    productCount: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

taxonomySchema.index({ kind: 1, order: 1 });
taxonomySchema.index({ name: 'text' });

export type TaxonomyAttrs = InferSchemaType<typeof taxonomySchema>;
export type TaxonomyDoc = HydratedDocument<TaxonomyAttrs>;
export const Taxonomy: Model<TaxonomyAttrs> = model<TaxonomyAttrs>('Taxonomy', taxonomySchema);
