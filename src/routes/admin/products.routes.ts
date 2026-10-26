import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { Product, Review, Category, Taxonomy } from '../../models/index.js';
import { presentProduct } from '../../lib/presenters.js';
import { cacheInvalidateTags } from '../../services/cache.service.js';
import { setSlotAvailability, setSlotQuantity } from '../../services/availability.service.js';
import { recalculateRating } from '../public/misc.routes.js';

export const adminProductsRouter = Router();

/* ------------------------------------------------------------------ */
/* List / create / update                                             */
/* ------------------------------------------------------------------ */

const listSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['publish', 'draft', 'pending', 'private', 'any']).optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  featured: z.enum(['1', '0', 'any']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'title', 'price-asc', 'price-desc']).optional(),
});

adminProductsRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listSchema>;
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 20);

    const filter: any = {};
    if (q.status && q.status !== 'any') filter.status = q.status;
    if (q.category) filter.categoryIds = q.category;
    if (q.tag) filter.tagIds = q.tag;
    if (q.featured && q.featured !== 'any') filter.isFeatured = q.featured === '1';
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { sku: rx }, { shortDescription: rx }];
    }

    const sortBy =
      q.sort === 'title'
        ? { title: 1 }
        : q.sort === 'price-asc'
          ? { price: 1 }
          : q.sort === 'price-desc'
            ? { price: -1 }
            : q.sort === 'oldest'
              ? { createdAt: 1 }
              : { createdAt: -1 };
    void 0;

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort(sortBy as never).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: products.map((p) => presentProduct(p, { full: true })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

const priceSchema = z.object({
  category: z.enum(['Adult', 'Child', 'Infant', 'Youth', 'Senior']),
  ageFrom: z.coerce.number().optional(),
  ageTo: z.coerce.number().optional(),
  buyingPrice: z.coerce.number().min(0).optional(),
  serviceCharge: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
  price: z.coerce.number().min(0).optional(),
});

const optionSchema = z.object({
  name: z.string().min(1),
  details: z.string().optional(),
  type: z.string().optional(),
  capacity: z.coerce.number().optional(),
  active: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  repeat: z.array(z.string()).optional(),
  startTime: z.array(z.string()).optional(),
  prices: z.array(priceSchema).optional(),
  lastDays: z.object({ days: z.coerce.number().optional(), percent: z.coerce.number().optional() }).optional(),
  duration: z.string().optional(),
  cutoff: z.coerce.number().optional(),
  languages: z.array(z.string()).optional(),
});

const productSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().optional(),
  sku: z.string().optional(),
  status: z.enum(['publish', 'draft', 'pending', 'private']).optional(),
  type: z.enum(['simple', 'variable', 'external', 'grouped']).optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  price: z.coerce.number().optional(),
  regularPrice: z.coerce.number().optional(),
  salePrice: z.coerce.number().optional(),
  onSale: z.boolean().optional(),
  images: z.array(z.object({ url: z.string(), alt: z.string().optional(), width: z.coerce.number().optional(), height: z.coerce.number().optional() })).optional(),
  gallery: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  activityTypeIds: z.array(z.string()).optional(),
  productOptions: z.array(optionSchema).optional(),
  passportRequirement: z.enum(['none', 'single', 'all']).optional(),
  keyPoints: z
    .object({
      cancellationPolicy: z.string().optional(),
      duration: z.string().optional(),
      lastMinuteAvailability: z.string().optional(),
      wheelchairAccessible: z.string().optional(),
      skipTheLine: z.string().optional(),
      guideType: z.string().optional(),
    })
    .optional(),
  importantInformation: z.object({ title: z.string().optional(), content: z.string().optional() }).optional(),
  liveTourGuide: z.object({ title: z.string().optional(), content: z.string().optional() }).optional(),
  trekksoftButtonLink: z.string().optional(),
  highlightedText: z.string().optional(),
  highlightedQuantityText: z.string().optional(),
  isFeatured: z.boolean().optional(),
  order: z.coerce.number().optional(),
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title) || 'product';
  let slug = base;
  let i = 1;
  /* eslint-disable no-await-in-loop */
  while (true) {
    const clash = await Product.findOne({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('_id');
    if (!clash) break;
    slug = `${base}-${i}`;
    i += 1;
  }
  /* eslint-enable no-await-in-loop */
  return slug;
}

adminProductsRouter.post(
  '/',
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productSchema>;
    const slug = body.slug ? slugify(body.slug) : await uniqueSlug(body.title);

    const product = await Product.create({
      ...body,
      slug,
      productOptions: (body.productOptions ?? []).map((option) => ({
        ...option,
        startTime: (option.startTime ?? []).map((t) => t.trim()),
        repeat: option.repeat ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      })),
    });

    cacheInvalidateTags('products');
    res.status(201).json({ success: true, data: presentProduct(product, { full: true }) });
  }),
);

adminProductsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(param(req, 'id'));
    if (!product) throw notFound('Product not found.');
    res.json({ success: true, data: presentProduct(product, { full: true }) });
  }),
);

adminProductsRouter.put(
  '/:id',
  validate(productSchema.partial()),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(param(req, 'id'));
    if (!product) throw notFound('Product not found.');

    const body = req.body as Partial<z.infer<typeof productSchema>>;
    if (body.title && body.title !== product.title && !body.slug) {
      body.slug = await uniqueSlug(body.title, String(product._id));
    }
    if (body.slug) body.slug = slugify(body.slug);

    Object.assign(product, body);
    await product.save();

    cacheInvalidateTags('products');
    res.json({ success: true, data: presentProduct(product, { full: true }) });
  }),
);

adminProductsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findByIdAndDelete(param(req, 'id'));
    if (!product) throw notFound('Product not found.');
    cacheInvalidateTags('products');
    res.json({ success: true, data: { deleted: true, id: param(req, 'id') } });
  }),
);

adminProductsRouter.post(
  '/bulk',
  validate(
    z.object({
      ids: z.array(z.string()).min(1),
      action: z.enum(['publish', 'draft', 'delete', 'feature', 'unfeature']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { ids, action } = req.body as { ids: string[]; action: string };

    if (action === 'delete') {
      await Product.deleteMany({ _id: { $in: ids } });
    } else if (action === 'feature') {
      await Product.updateMany({ _id: { $in: ids } }, { $set: { isFeatured: true } });
    } else if (action === 'unfeature') {
      await Product.updateMany({ _id: { $in: ids } }, { $set: { isFeatured: false } });
    } else {
      await Product.updateMany({ _id: { $in: ids } }, { $set: { status: action } });
    }

    cacheInvalidateTags('products');
    res.json({ success: true, data: { affected: ids.length, action } });
  }),
);

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

adminProductsRouter.get(
  '/:id/availability',
  validate(
    z.object({
      option: z.coerce.number().int().min(0).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(param(req, 'id'));
    if (!product) throw notFound('Product not found.');

    const { option = 0, from, to } = req.query as unknown as { option: number; from?: string; to?: string };
    const start = from ?? new Date().toISOString().slice(0, 10);
    const end = to ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const { availabilityCalendar } = await import('../../services/availability.service.js');
    res.json({
      success: true,
      data: {
        productId: String(product._id),
        option,
        from: start,
        to: end,
        options: product.productOptions.map((o, index) => ({ index, name: o.name, startTime: o.startTime })),
        calendar: availabilityCalendar(product, option, start, end),
      },
    });
  }),
);

adminProductsRouter.post(
  '/:id/availability',
  validate(
    z.object({
      option: z.coerce.number().int().min(0).default(0),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().min(1),
      unavailable: z.boolean().optional(),
      quantity: z.coerce.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(param(req, 'id'));
    if (!product) throw notFound('Product not found.');

    const body = req.body as { option: number; date: string; time: string; unavailable?: boolean; quantity?: number };

    if (body.unavailable !== undefined) {
      setSlotAvailability(product, body.option, body.date, body.time, body.unavailable);
    }
    if (body.quantity !== undefined) {
      setSlotQuantity(product, body.option, body.date, body.time, body.quantity);
    }

    await product.save();
    cacheInvalidateTags('products');

    res.json({ success: true, data: { saved: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Reviews on a product                                                */
/* ------------------------------------------------------------------ */

adminProductsRouter.get(
  '/:id/reviews',
  asyncHandler(async (req, res) => {
    const reviews = await Review.find({ productId: param(req, 'id') }).sort({ createdAt: -1 });
    res.json({
      success: true,
      data: reviews.map((r) => ({ ...r.toJSON(), id: String(r._id) })),
    });
  }),
);

adminProductsRouter.post(
  '/:id/reviews',
  validate(
    z.object({
      authorName: z.string().min(1, 'Author name is required'),
      authorEmail: z.string().email().optional(),
      rating: z.coerce.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      content: z.string().min(1),
      status: z.enum(['approved', 'pending', 'spam', 'rejected']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(param(req, 'id'));
    if (!product) throw notFound('Product not found.');

    const body = req.body as {
      authorName: string;
      authorEmail?: string;
      rating: number;
      title?: string;
      content: string;
      status?: 'approved' | 'pending' | 'spam' | 'rejected';
    };

    const review = await Review.create({
      productId: product._id,
      authorName: body.authorName,
      authorEmail: body.authorEmail?.toLowerCase(),
      rating: body.rating,
      title: body.title ?? '',
      content: body.content,
      status: body.status ?? 'approved',
      source: 'manual',
      verifiedBooking: false,
    });

    await recalculateRating(String(product._id));

    res.status(201).json({ success: true, data: { ...review.toJSON(), id: String(review._id) } });
  }),
);

/* ------------------------------------------------------------------ */
/* Category product counts (used by the admin products table)          */
/* ------------------------------------------------------------------ */

adminProductsRouter.get(
  '/meta/filters',
  asyncHandler(async (_req, res) => {
    const [categories, tags, activityTypes] = await Promise.all([
      Category.find().select('name slug').sort({ name: 1 }),
      Taxonomy.find({ kind: 'product_tag' }).select('name slug').sort({ name: 1 }),
      Taxonomy.find({ kind: 'activity_type' }).select('name slug').sort({ name: 1 }),
    ]);
    res.json({
      success: true,
      data: {
        categories: categories.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })),
        tags: tags.map((t) => ({ id: String(t._id), name: t.name, slug: t.slug })),
        activityTypes: activityTypes.map((t) => ({ id: String(t._id), name: t.name, slug: t.slug })),
      },
    });
  }),
);
