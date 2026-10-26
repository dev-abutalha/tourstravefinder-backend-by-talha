import { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/** Blog category (WordPress `category`). */
const blogCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'BlogCategory', default: null, index: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    postCount: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

blogCategorySchema.index({ parentId: 1, order: 1 });

export type BlogCategoryAttrs = InferSchemaType<typeof blogCategorySchema>;
export type BlogCategoryDoc = HydratedDocument<BlogCategoryAttrs>;
export const BlogCategory: Model<BlogCategoryAttrs> = model<BlogCategoryAttrs>('BlogCategory', blogCategorySchema);

/** Blog post (WordPress `post`). */
const postSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['publish', 'draft', 'pending', 'private'], default: 'publish', index: true },
    excerpt: { type: String, default: '' },
    content: { type: String, default: '' },
    contentHtml: { type: String, default: '' },
    authorName: { type: String, default: '' },
    image: { type: String, default: '' },
    gallery: { type: [String], default: [] },
    categoryIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    tagIds: { type: [Schema.Types.ObjectId], default: [] },
    /** WP page meta `_related_products` */
    relatedProductIds: { type: [Schema.Types.ObjectId], default: [] },
    commentCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    readingMinutes: { type: Number, default: 3 },
    seo: {
      title: String,
      description: String,
      focusKeyword: String,
      canonical: String,
      noIndex: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

postSchema.index({ title: 'text', excerpt: 'text', content: 'text' });
postSchema.index({ status: 1, publishedAt: -1 });

postSchema.virtual('publishedAt').get(function (this: PostDoc) {
  return this.createdAt;
});

export type PostAttrs = InferSchemaType<typeof postSchema>;
export type PostDoc = HydratedDocument<PostAttrs>;
export const Post: Model<PostAttrs> = model<PostAttrs>('Post', postSchema);

/**
 * Static page. `template` maps to the original WordPress page template
 * (home, destination, attraction, guided-tours, faq, order-status, ...).
 */
const pageSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['publish', 'draft', 'pending', 'private'], default: 'publish' },
    template: { type: String, default: 'default', index: true },
    content: { type: String, default: '' },
    excerpt: { type: String, default: '' },
    image: { type: String, default: '' },
    /** WP page meta `_selected_category` (product_cat id) */
    selectedCategoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    /** WP page meta `_selected_product_tag` (product_tag id) */
    selectedTagId: { type: Schema.Types.ObjectId, default: null },
    /** WP page meta `_why_visit_us_title` / `_why_visit_us_cards` */
    whyVisitUs: {
      title: { type: String, default: '' },
      cards: {
        type: [
          new Schema({ title: String, description: String }, { _id: false }),
        ],
        default: [],
      },
    },
    gallery: { type: [String], default: [] },
    seo: {
      title: String,
      description: String,
      focusKeyword: String,
      canonical: String,
      noIndex: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

pageSchema.index({ template: 1, status: 1 });

export type PageAttrs = InferSchemaType<typeof pageSchema>;
export type PageDoc = HydratedDocument<PageAttrs>;
export const Page: Model<PageAttrs> = model<PageAttrs>('Page', pageSchema);
