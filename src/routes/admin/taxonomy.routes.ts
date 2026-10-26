import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { notFound } from '../../lib/errors.js';
import { Category, Taxonomy, Product } from '../../models/index.js';
import { presentCategory } from '../../lib/presenters.js';
import { cacheInvalidateTags } from '../../services/cache.service.js';

export const adminTaxonomyRouter = Router();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------ */
/* Categories (product_cat)                                           */
/* ------------------------------------------------------------------ */

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  parentId: z.string().nullable().optional(),
  description: z.string().optional(),
  categoryType: z.enum(['', 'country', 'city', 'attraction']).optional(),
  categoryPageLink: z.string().optional(),
  topExperience: z.boolean().optional(),
  topAttraction: z.boolean().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  order: z.coerce.number().optional(),
  seo: z.object({ title: z.string().optional(), description: z.string().optional() }).optional(),
});

adminTaxonomyRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await Category.find().sort({ order: 1, name: 1 });
    res.json({ success: true, data: categories.map(presentCategory) });
  }),
);

adminTaxonomyRouter.post(
  '/categories',
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof categorySchema>;
    const slug = body.slug ? slugify(body.slug) : slugify(body.name);
    const category = await Category.create({ ...body, slug, parentId: body.parentId || null });
    cacheInvalidateTags('categories');
    res.status(201).json({ success: true, data: presentCategory(category) });
  }),
);

adminTaxonomyRouter.put(
  '/categories/:id',
  validate(categorySchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof categorySchema>>;
    if (body.slug) body.slug = slugify(body.slug);
    const category = await Category.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!category) throw notFound('Category not found.');
    cacheInvalidateTags('categories');
    res.json({ success: true, data: presentCategory(category) });
  }),
);

adminTaxonomyRouter.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const category = await Category.findByIdAndDelete(param(req, 'id'));
    if (!category) throw notFound('Category not found.');
    await Category.updateMany({ parentId: category._id }, { $set: { parentId: null } });
    await Product.updateMany({ categoryIds: category._id }, { $pull: { categoryIds: category._id } });
    cacheInvalidateTags('categories', 'products');
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Tags & activity types                                              */
/* ------------------------------------------------------------------ */

adminTaxonomyRouter.get(
  '/taxonomies/:kind',
  asyncHandler(async (req, res) => {
    const kind = param(req, 'kind') as 'product_tag' | 'activity_type';
    const items = await Taxonomy.find({ kind }).sort({ order: 1, name: 1 });
    res.json({ success: true, data: items.map((t) => ({ ...t.toJSON(), id: String(t._id) })) });
  }),
);

adminTaxonomyRouter.post(
  '/taxonomies/:kind',
  validate(
    z.object({
      name: z.string().min(1),
      slug: z.string().optional(),
      parentId: z.string().nullable().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      order: z.coerce.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const kind = param(req, 'kind') as 'product_tag' | 'activity_type';
    const body = req.body as { name: string; slug?: string; parentId?: string | null };
    const item = await Taxonomy.create({
      ...body,
      kind,
      slug: body.slug ? slugify(body.slug) : slugify(body.name),
      parentId: body.parentId || null,
    });
    cacheInvalidateTags('categories');
    res.status(201).json({ success: true, data: { ...item.toJSON(), id: String(item._id) } });
  }),
);

adminTaxonomyRouter.put(
  '/taxonomies/:kind/:id',
  validate(
    z.object({
      name: z.string().min(1).optional(),
      slug: z.string().optional(),
      parentId: z.string().nullable().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      order: z.coerce.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.slug) body.slug = slugify(body.slug as string);
    const item = await Taxonomy.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!item) throw notFound('Taxonomy term not found.');
    cacheInvalidateTags('categories');
    res.json({ success: true, data: { ...item.toJSON(), id: String(item._id) } });
  }),
);

adminTaxonomyRouter.delete(
  '/taxonomies/:kind/:id',
  asyncHandler(async (req, res) => {
    const item = await Taxonomy.findByIdAndDelete(param(req, 'id'));
    if (!item) throw notFound('Taxonomy term not found.');

    if (item.kind === 'product_tag') await Product.updateMany({ tagIds: item._id }, { $pull: { tagIds: item._id } });
    else await Product.updateMany({ activityTypeIds: item._id }, { $pull: { activityTypeIds: item._id } });

    cacheInvalidateTags('categories', 'products');
    res.json({ success: true, data: { deleted: true } });
  }),
);
