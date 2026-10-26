import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { presentCategory, presentProduct } from '../../lib/presenters.js';
import { cacheInvalidateTags, cacheKeys, cacheRemember } from '../../services/cache.service.js';
import {
  BlogCategory,
  Category,
  Faq,
  FaqCategory,
  Page,
  Post,
  Product,
  Showcase,
  Taxonomy,
} from '../../models/index.js';

export const catalogRouter = Router();

/* ------------------------------------------------------------------ */
/* Products                                                           */
/* ------------------------------------------------------------------ */

const listQuerySchema = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  activityType: z.string().optional(),
  search: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  featured: z.enum(['1', 'true']).optional(),
  sort: z.enum(['newest', 'oldest', 'price-asc', 'price-desc', 'rating', 'popular']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

catalogRouter.get(
  '/products',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuerySchema>;
    const { skip, limit, page } = paginate(q as Record<string, unknown>, q.page ?? 1, q.limit ?? 20);

    const filter: any = { status: 'publish' };

    if (q.category) filter.categoryIds = q.category;
    if (q.tag) filter.tagIds = q.tag;
    if (q.activityType) filter.activityTypeIds = q.activityType;
    if (q.featured) filter.isFeatured = true;
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      filter.price = {
        ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}),
        ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}),
      };
    }
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { shortDescription: rx }, { description: rx }];
    }

    const sortMap: Record<string, 1 | -1> = {
      newest: -1,
      oldest: 1,
      'price-asc': 1,
      'price-desc': -1,
      rating: -1,
      popular: -1,
    };
    const sortField = sortMap[q.sort ?? 'newest'] === 1 ? 1 : -1;
    const sortBy =
      q.sort === 'price-asc' || q.sort === 'price-desc'
        ? { price: sortField }
        : q.sort === 'rating'
          ? { 'rating.average': sortField }
          : q.sort === 'popular'
            ? { bookingCount: sortField }
            : { createdAt: sortField };
    void 0;

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort(sortBy as never).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: products.map((p) => presentProduct(p)),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: page * limit < total },
    });
  }),
);

catalogRouter.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ slug: param(req, 'slug'), status: 'publish' });
    if (!product) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } });
      return;
    }

    const related = await Product.find({
      _id: { $ne: product._id },
      status: 'publish',
      $or: [{ categoryIds: { $in: product.categoryIds } }, { tagIds: { $in: product.tagIds } }],
    }).limit(8);

    res.json({
      success: true,
      data: {
        ...presentProduct(product, { full: true }),
        related: related.map((p) => presentProduct(p)),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Categories & taxonomies                                             */
/* ------------------------------------------------------------------ */

catalogRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await cacheRemember(
      'category-tree',
      async () => Category.find().sort({ order: 1, name: 1 }),
      6 * 60 * 60,
      ['categories'],
    );

    const grouped = new Map<string, number>();
    const products = await Product.find({ status: 'publish' }).select('categoryIds');
    for (const product of products) {
      for (const id of product.categoryIds ?? []) {
        grouped.set(String(id), (grouped.get(String(id)) ?? 0) + 1);
      }
    }

    res.json({
      success: true,
      data: categories.map((c) => ({
        ...presentCategory(c),
        productCount: grouped.get(String(c._id)) ?? c.productCount ?? 0,
      })),
    });
  }),
);

catalogRouter.get(
  '/categories/:slug',
  asyncHandler(async (req, res) => {
    const category = await Category.findOne({ slug: param(req, 'slug') });
    if (!category) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Category not found' } });
      return;
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 12;
    const filter: any = { status: 'publish', categoryIds: category._id };

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ]);

    const children = await Category.find({ parentId: category._id }).sort({ order: 1 });

    res.json({
      success: true,
      data: {
        ...presentCategory(category),
        children: children.map(presentCategory),
      },
      products: (products as any[]).map((p) => presentProduct(p)),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

function menuCategory(c: any, count: number) {
  return {
    id: String(c._id),
    name: c.name,
    href: `/categories/${c.slug}`,
    image: c.image ?? '',
    count,
  };
}

function menuPost(p: any) {
  return {
    id: String(p._id),
    name: p.title,
    href: `/blog/${p.slug}`,
    image: p.image ?? '',
  };
}

catalogRouter.get(
  '/menu',
  asyncHandler(async (_req, res) => {
    const data = await cacheRemember(
      cacheKeys.menuTree(),
      async () => {
        const categories = await Category.find().sort({ order: 1, name: 1 });
        const counts = new Map<string, number>();
        const products = await Product.find({ status: 'publish' }).select('categoryIds');
        for (const product of products) {
          for (const id of product.categoryIds ?? []) {
            counts.set(String(id), (counts.get(String(id)) ?? 0) + 1);
          }
        }
        const countOf = (c: any) => counts.get(String(c._id)) ?? c.productCount ?? 0;

        const roots = categories.filter((c: any) => !c.parentId);
        const topAttractions = categories
          .filter((c: any) => c.topAttraction && c.categoryType === 'attraction')
          .sort((a: any, b: any) => countOf(b) - countOf(a) || a.name.localeCompare(b.name))
          .slice(0, 18);
        const placesItems = [
          {
            id: 'top-attractions',
            name: 'Top attractions',
            href: '/attractions',
            image: topAttractions[0]?.image ?? '',
            count: topAttractions.reduce((sum: number, c: any) => sum + countOf(c), 0),
          },
          ...roots.map((c: any) => menuCategory(c, countOf(c))),
        ];
        const placesChildren: Record<string, any[]> = {
          'top-attractions': topAttractions.map((c: any) => menuCategory(c, countOf(c))),
        };
        for (const root of roots) {
          placesChildren[String(root._id)] = categories
            .filter((c: any) => String(c.parentId) === String(root._id))
            .sort((a: any, b: any) => countOf(b) - countOf(a) || a.name.localeCompare(b.name))
            .slice(0, 18)
            .map((c: any) => menuCategory(c, countOf(c)));
        }

        const topExperiences = categories
          .filter((c: any) => c.topExperience)
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        const thingsChildrenList = await Promise.all(
          topExperiences.map((c: any) =>
            Product.find({ status: 'publish', categoryIds: c._id })
              .sort({ bookingCount: -1, createdAt: -1 })
              .limit(12)
              .select('title slug images'),
          ),
        );
        const thingsChildren: Record<string, any[]> = {};
        topExperiences.forEach((c: any, index: number) => {
          thingsChildren[String(c._id)] = thingsChildrenList[index].map((p: any) => ({
            id: String(p._id),
            name: p.title,
            href: `/products/${p.slug}`,
            image: p.images?.[0]?.url ?? '',
          }));
        });

        const blogCategories = await BlogCategory.find().sort({ name: 1 });
        const blogRoots = ['city-guides', 'travel-guides', 'travel-tips']
          .map((slug) => blogCategories.find((c: any) => c.slug === slug))
          .filter(Boolean);
        const blogChildren: Record<string, any[]> = {};
        const cityGuide = blogRoots.find((c: any) => c.slug === 'city-guides');
        const cityChildren = cityGuide
          ? blogCategories.filter((c: any) => String(c.parentId) === String(cityGuide._id))
          : [];
        const cityImages = new Map<string, string>();
        if (cityChildren.length) {
          const cityPosts = await Post.find({
            status: 'publish',
            categoryIds: { $in: cityChildren.map((c: any) => c._id) },
          })
            .sort({ createdAt: -1 })
            .select('categoryIds image');
          for (const post of cityPosts) {
            for (const id of post.categoryIds ?? []) {
              const key = String(id);
              if (!cityImages.has(key)) cityImages.set(key, post.image ?? '');
            }
          }
        }
        if (cityGuide) {
          blogChildren[String(cityGuide._id)] = cityChildren.map((c: any) => ({
            id: String(c._id),
            name: c.name,
            href: `/blog?category=${c._id}`,
            image: cityImages.get(String(c._id)) ?? c.image ?? '',
            count: c.postCount ?? 0,
          }));
        }
        const storyRoots = blogRoots.filter((c: any) => c.slug !== 'city-guides');
        const storyPosts = await Promise.all(
          storyRoots.map((c: any) =>
            Post.find({ status: 'publish', categoryIds: c._id })
              .sort({ createdAt: -1 })
              .limit(12)
              .select('title slug image'),
          ),
        );
        storyRoots.forEach((c: any, index: number) => {
          blogChildren[String(c._id)] = storyPosts[index].map(menuPost);
        });

        return {
          places: { label: 'Places to see', href: '/destinations', items: placesItems, children: placesChildren },
          things: {
            label: 'Things to do',
            href: '/products',
            items: topExperiences.map((c: any) => menuCategory(c, countOf(c))),
            children: thingsChildren,
          },
          blog: {
            label: 'Travel guide',
            href: '/blog',
            items: blogRoots.map((c: any) => ({
              id: String(c._id),
              name: c.name,
              href: `/blog?category=${c._id}`,
              image: c.image ?? '',
              count: c.postCount ?? 0,
            })),
            children: blogChildren,
          },
        };
      },
      15 * 60,
      ['categories', 'products', 'posts', 'blog-categories'],
    );

    res.json({ success: true, data });
  }),
);

catalogRouter.get(
  '/blog-categories',
  asyncHandler(async (_req, res) => {
    const categories = await cacheRemember(
      'blog-categories',
      async () => BlogCategory.find().sort({ name: 1 }),
      6 * 60 * 60,
      ['blog-categories'],
    );
    res.json({
      success: true,
      data: categories.map((c: any) => ({
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        parentId: c.parentId ? String(c.parentId) : null,
        image: c.image ?? '',
        postCount: c.postCount ?? 0,
      })),
    });
  }),
);

catalogRouter.get(
  '/taxonomies/:kind',
  asyncHandler(async (req, res) => {
    const kind = param(req, 'kind') as 'product_tag' | 'activity_type';
    if (!['product_tag', 'activity_type'].includes(kind)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown taxonomy' } });
      return;
    }
    const items = await Taxonomy.find({ kind }).sort({ order: 1, name: 1 });
    res.json({ success: true, data: items.map((t) => ({ ...t, id: String(t._id) })) });
  }),
);

/* ------------------------------------------------------------------ */
/* Showcase (Top Destinations / Top Attractions)                        */
/* ------------------------------------------------------------------ */

catalogRouter.get(
  '/showcases/:kind',
  asyncHandler(async (req, res) => {
    const kind = param(req, 'kind') as 'destination' | 'attraction';
    if (!['destination', 'attraction'].includes(kind)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown showcase' } });
      return;
    }
    const items = await Showcase.find({ kind, status: 'publish' }).sort({ createdAt: 1 });
    res.json({ success: true, data: items.map((s) => ({ ...s.toJSON(), id: String(s._id) })) });
  }),
);

catalogRouter.get(
  '/showcases/:kind/:id',
  asyncHandler(async (req, res) => {
    const item = await Showcase.findOne({ _id: param(req, 'id'), kind: param(req, 'kind') } as any);
    if (!item) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    res.json({ success: true, data: { ...(item as any).toJSON(), id: String((item as any)._id) } });
  }),
);

/* ------------------------------------------------------------------ */
/* FAQ                                                                */
/* ------------------------------------------------------------------ */

catalogRouter.get(
  '/faqs',
  asyncHandler(async (req, res) => {
    const filter: any = { status: 'publish' };
    if (req.query.category) filter.categoryIds = req.query.category;
    const items = await Faq.find(filter).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: items.map((f) => ({ ...f.toJSON(), id: String(f._id) })) });
  }),
);

catalogRouter.get(
  '/faq-categories',
  asyncHandler(async (_req, res) => {
    const categories = await FaqCategory.find().sort({ order: 1, name: 1 });
    res.json({ success: true, data: categories.map((c) => ({ ...c.toJSON(), id: String(c._id) })) });
  }),
);

/* ------------------------------------------------------------------ */
/* Pages & posts                                                      */
/* ------------------------------------------------------------------ */

catalogRouter.get(
  '/pages',
  asyncHandler(async (req, res) => {
    const filter: any = { status: 'publish' };
    if (req.query.template) filter.template = req.query.template;
    const pages = await Page.find(filter).sort({ title: 1 });
    res.json({ success: true, data: pages.map((p) => ({ ...p.toJSON(), id: String(p._id) })) });
  }),
);

catalogRouter.get(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const page = await Page.findOne({ slug: param(req, 'slug'), status: 'publish' });
    if (!page) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Page not found' } });
      return;
    }
    res.json({ success: true, data: { ...page.toJSON(), id: String(page._id) } });
  }),
);

catalogRouter.get(
  '/posts',
  validate(
    z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { category?: string; search?: string; page?: number; limit?: number };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 12);

    const filter: any = { status: 'publish' };
    if (q.category) filter.categoryIds = q.category;
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { excerpt: rx }, { content: rx }];
    }

    const [total, posts] = await Promise.all([
      Post.countDocuments(filter),
      Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: posts.map((p) => ({ ...p.toJSON(), id: String(p._id) })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

catalogRouter.get(
  '/posts/:slug',
  asyncHandler(async (req, res) => {
    const post = await Post.findOne({ slug: param(req, 'slug'), status: 'publish' });
    if (!post) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Post not found' } });
      return;
    }
    await Post.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } });

    const related = await Post.find({
      _id: { $ne: post._id },
      status: 'publish',
      categoryIds: { $in: post.categoryIds },
    })
      .limit(4)
      .select('title slug excerpt image createdAt');

    const relatedProducts = post.relatedProductIds?.length
      ? await Product.find({ _id: { $in: post.relatedProductIds }, status: 'publish' })
      : [];

    res.json({
      success: true,
      data: {
        ...post.toJSON(),
        id: String(post._id),
        related: related.map((r) => ({ ...r.toJSON(), id: String(r._id) })),
        relatedProducts: relatedProducts.map((p) => presentProduct(p)),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

catalogRouter.get(
  '/search',
  validate(
    z.object({
      q: z.string().min(1),
      type: z.enum(['all', 'products', 'categories', 'posts']).optional(),
      limit: z.coerce.number().int().positive().max(30).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { q, type = 'all', limit = 12 } = req.query as unknown as { q: string; type: string; limit: number };
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const [products, categories, posts] = await Promise.all([
      type === 'all' || type === 'products'
        ? Product.find({ status: 'publish', $or: [{ title: rx }, { shortDescription: rx }] }).limit(limit)
        : [],
      type === 'all' || type === 'categories'
        ? Category.find({ $or: [{ name: rx }, { description: rx }] }).limit(limit)
        : [],
      type === 'all' || type === 'posts'
        ? Post.find({ status: 'publish', $or: [{ title: rx }, { excerpt: rx }] }).limit(limit)
        : [],
    ]);

    res.json({
      success: true,
      data: {
        products: (products as any[]).map((p) => presentProduct(p)),
        categories: categories.map(presentCategory),
        posts: posts.map((p) => ({ ...p.toJSON(), id: String(p._id) })),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Home aggregation                                                   */
/* ------------------------------------------------------------------ */

/** Single call that powers the whole homepage - far fewer round trips. */
catalogRouter.get(
  '/home',
  asyncHandler(async (_req, res) => {
    const data = await cacheRemember(
      'home-aggregate',
      async () => {
        const [featuredRaw, newestRaw, destinationsRaw, attractionsRaw, promo] = await Promise.all([
          Product.find({ status: 'publish', isFeatured: true }).sort({ bookingCount: -1 }).limit(8),
          Product.find({ status: 'publish' }).sort({ createdAt: -1 }).limit(8),
          Showcase.find({ kind: 'destination', status: 'publish' }).limit(6),
          Showcase.find({ kind: 'attraction', status: 'publish' }).limit(6),
          Page.findOne({ slug: 'home' }).lean(),
        ]);
        return {
          featured: featuredRaw as unknown[],
          newest: newestRaw as unknown[],
          destinations: destinationsRaw as unknown[],
          attractions: attractionsRaw as unknown[],
          promo: promo ?? null,
        };
      },
      15 * 60,
      ['products', 'showcases', 'pages'],
    );

    res.json({
      success: true,
      data: {
        featured: (data.featured as any[]).map((p) => presentProduct(p)),
        newest: (data.newest as any[]).map((p) => presentProduct(p)),
        destinations: (data.destinations as any[]).map((d) => ({ ...d.toJSON(), id: String(d._id) })),
        attractions: (data.attractions as any[]).map((d) => ({ ...d.toJSON(), id: String(d._id) })),
        page: data.promo ? { ...data.promo, id: String(data.promo._id) } : null,
        builtAt: dayjs().toISOString(),
      },
    });
  }),
);

/** Invalidates cached catalog fragments (used by the admin panel). */
export function invalidateCatalogCache() {
  cacheInvalidateTags('products', 'categories', 'showcases', 'pages', 'posts', 'blog-categories');
}
