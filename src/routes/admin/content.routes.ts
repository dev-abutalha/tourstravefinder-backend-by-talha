import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { notFound } from '../../lib/errors.js';
import { Faq, FaqCategory, Page, Post, Showcase } from '../../models/index.js';
import { cacheInvalidateTags } from '../../services/cache.service.js';

export const adminContentRouter = Router();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const plain = (doc: { toJSON: () => Record<string, unknown> }) => {
  const json = doc.toJSON();
  return { ...json, id: String(json._id) };
};

/* ------------------------------------------------------------------ */
/* Pages                                                              */
/* ------------------------------------------------------------------ */

const pageSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  status: z.enum(['publish', 'draft', 'pending', 'private']).optional(),
  template: z.string().optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  image: z.string().optional(),
  gallery: z.array(z.string()).optional(),
  selectedCategoryId: z.string().nullable().optional(),
  selectedTagId: z.string().nullable().optional(),
  whyVisitUs: z
    .object({
      title: z.string().optional(),
      cards: z.array(z.object({ title: z.string().optional(), description: z.string().optional() })).optional(),
    })
    .optional(),
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      focusKeyword: z.string().optional(),
      canonical: z.string().optional(),
      noIndex: z.boolean().optional(),
    })
    .optional(),
});

adminContentRouter.get(
  '/pages',
  validate(z.object({ template: z.string().optional(), status: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const filter: any = {};
    if (req.query.template) filter.template = req.query.template;
    if (req.query.status && req.query.status !== 'any') filter.status = req.query.status;
    const pages = await Page.find(filter).sort({ title: 1 });
    res.json({ success: true, data: pages.map(plain) });
  }),
);

adminContentRouter.post(
  '/pages',
  validate(pageSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof pageSchema>;
    const page = await Page.create({ ...body, slug: body.slug ? slugify(body.slug) : slugify(body.title) });
    cacheInvalidateTags('pages');
    res.status(201).json({ success: true, data: plain(page) });
  }),
);

adminContentRouter.put(
  '/pages/:id',
  validate(pageSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.slug) body.slug = slugify(body.slug as string);
    const page = await Page.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!page) throw notFound('Page not found.');
    cacheInvalidateTags('pages');
    res.json({ success: true, data: plain(page) });
  }),
);

adminContentRouter.delete(
  '/pages/:id',
  asyncHandler(async (req, res) => {
    const page = await Page.findByIdAndDelete(param(req, 'id'));
    if (!page) throw notFound('Page not found.');
    cacheInvalidateTags('pages');
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Blog posts                                                         */
/* ------------------------------------------------------------------ */

const postSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  status: z.enum(['publish', 'draft', 'pending', 'private']).optional(),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  contentHtml: z.string().optional(),
  authorName: z.string().optional(),
  image: z.string().optional(),
  gallery: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  relatedProductIds: z.array(z.string()).optional(),
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      focusKeyword: z.string().optional(),
      canonical: z.string().optional(),
      noIndex: z.boolean().optional(),
    })
    .optional(),
});

adminContentRouter.get(
  '/posts',
  validate(
    z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { search?: string; status?: string; page?: number; limit?: number };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 20);

    const filter: any = {};
    if (q.status && q.status !== 'any') filter.status = q.status;
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { excerpt: rx }];
    }

    const [total, posts] = await Promise.all([
      Post.countDocuments(filter),
      Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: posts.map(plain),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

adminContentRouter.post(
  '/posts',
  validate(postSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof postSchema>;
    const post = await Post.create({ ...body, slug: body.slug ? slugify(body.slug) : slugify(body.title) });
    res.status(201).json({ success: true, data: plain(post) });
  }),
);

adminContentRouter.put(
  '/posts/:id',
  validate(postSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.slug) body.slug = slugify(body.slug as string);
    const post = await Post.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!post) throw notFound('Post not found.');
    res.json({ success: true, data: plain(post) });
  }),
);

adminContentRouter.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const post = await Post.findByIdAndDelete(param(req, 'id'));
    if (!post) throw notFound('Post not found.');
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Showcases (Top Destinations / Top Attractions)                      */
/* ------------------------------------------------------------------ */

const showcaseSchema = z.object({
  kind: z.enum(['destination', 'attraction']),
  title: z.string().min(1),
  slug: z.string().optional(),
  status: z.enum(['publish', 'draft']).optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        link: z.string().optional(),
        pageTitle: z.string().optional(),
        productId: z.string().nullable().optional(),
        order: z.coerce.number().optional(),
      }),
    )
    .optional(),
});

adminContentRouter.get(
  '/showcases',
  validate(z.object({ kind: z.enum(['destination', 'attraction']).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const filter: any = {};
    if (req.query.kind) filter.kind = req.query.kind;
    const items = await Showcase.find(filter).sort({ createdAt: 1 });
    res.json({ success: true, data: items.map(plain) });
  }),
);

adminContentRouter.post(
  '/showcases',
  validate(showcaseSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof showcaseSchema>;
    const item = await Showcase.create({ ...body, slug: body.slug ? slugify(body.slug) : slugify(body.title) });
    cacheInvalidateTags('showcases');
    res.status(201).json({ success: true, data: plain(item) });
  }),
);

adminContentRouter.put(
  '/showcases/:id',
  validate(showcaseSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.slug) body.slug = slugify(body.slug as string);
    const item = await Showcase.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!item) throw notFound('Showcase not found.');
    cacheInvalidateTags('showcases');
    res.json({ success: true, data: plain(item) });
  }),
);

adminContentRouter.delete(
  '/showcases/:id',
  asyncHandler(async (req, res) => {
    const item = await Showcase.findByIdAndDelete(param(req, 'id'));
    if (!item) throw notFound('Showcase not found.');
    cacheInvalidateTags('showcases');
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* FAQs                                                               */
/* ------------------------------------------------------------------ */

adminContentRouter.get(
  '/faqs',
  validate(z.object({ category: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const filter: any = {};
    if (req.query.category) filter.categoryIds = req.query.category;
    const items = await Faq.find(filter).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: items.map(plain) });
  }),
);

adminContentRouter.post(
  '/faqs',
  validate(
    z.object({
      title: z.string().min(1),
      slug: z.string().optional(),
      status: z.enum(['publish', 'draft']).optional(),
      content: z.string().optional(),
      excerpt: z.string().optional(),
      categoryIds: z.array(z.string()).optional(),
      order: z.coerce.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { title: string; slug?: string; categoryIds?: string[] };
    const item = await Faq.create({ ...body, slug: body.slug ? slugify(body.slug) : slugify(body.title) });
    res.status(201).json({ success: true, data: plain(item) });
  }),
);

adminContentRouter.put(
  '/faqs/:id',
  validate(
    z.object({
      title: z.string().min(1).optional(),
      slug: z.string().optional(),
      status: z.enum(['publish', 'draft']).optional(),
      content: z.string().optional(),
      excerpt: z.string().optional(),
      categoryIds: z.array(z.string()).optional(),
      order: z.coerce.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.slug) body.slug = slugify(body.slug as string);
    const item = await Faq.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!item) throw notFound('FAQ not found.');
    res.json({ success: true, data: plain(item) });
  }),
);

adminContentRouter.delete(
  '/faqs/:id',
  asyncHandler(async (req, res) => {
    const item = await Faq.findByIdAndDelete(param(req, 'id'));
    if (!item) throw notFound('FAQ not found.');
    res.json({ success: true, data: { deleted: true } });
  }),
);

adminContentRouter.get(
  '/faq-categories',
  asyncHandler(async (_req, res) => {
    const items = await FaqCategory.find().sort({ order: 1, name: 1 });
    res.json({ success: true, data: items.map(plain) });
  }),
);

adminContentRouter.post(
  '/faq-categories',
  validate(
    z.object({
      name: z.string().min(1),
      slug: z.string().optional(),
      parentId: z.string().nullable().optional(),
      description: z.string().optional(),
      order: z.coerce.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { name: string; slug?: string };
    const item = await FaqCategory.create({ ...body, slug: body.slug ? slugify(body.slug) : slugify(body.name) });
    res.status(201).json({ success: true, data: plain(item) });
  }),
);

adminContentRouter.put(
  '/faq-categories/:id',
  validate(
    z.object({
      name: z.string().min(1).optional(),
      slug: z.string().optional(),
      parentId: z.string().nullable().optional(),
      description: z.string().optional(),
      order: z.coerce.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.slug) body.slug = slugify(body.slug as string);
    const item = await FaqCategory.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!item) throw notFound('FAQ category not found.');
    res.json({ success: true, data: plain(item) });
  }),
);

adminContentRouter.delete(
  '/faq-categories/:id',
  asyncHandler(async (req, res) => {
    const item = await FaqCategory.findByIdAndDelete(param(req, 'id'));
    if (!item) throw notFound('FAQ category not found.');
    await Faq.updateMany({ categoryIds: item._id }, { $pull: { categoryIds: item._id } });
    res.json({ success: true, data: { deleted: true } });
  }),
);
