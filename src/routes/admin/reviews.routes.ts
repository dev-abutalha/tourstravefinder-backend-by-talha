import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { notFound } from '../../lib/errors.js';
import { Order, Product, Review, ReviewToken } from '../../models/index.js';
import { recalculateRating } from '../public/misc.routes.js';

export const adminReviewsRouter = Router();

/* ------------------------------------------------------------------ */
/* Review moderation                                                  */
/* ------------------------------------------------------------------ */

adminReviewsRouter.get(
  '/',
  validate(
    z.object({
      productId: z.string().optional(),
      status: z.string().optional(),
      source: z.string().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      productId?: string;
      status?: string;
      source?: string;
      search?: string;
      page?: number;
      limit?: number;
    };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 20);

    const filter: any = {};
    if (q.productId) filter.productId = q.productId;
    if (q.status && q.status !== 'any') filter.status = q.status;
    if (q.source && q.source !== 'any') filter.source = q.source;
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ authorName: rx }, { content: rx }, { title: rx }];
    }

    const [total, reviews] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    const products = await Product.find({ _id: { $in: reviews.map((r) => r.productId) } }).select('title slug');
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    res.json({
      success: true,
      data: reviews.map((r) => ({
        ...r.toJSON(),
        id: String(r._id),
        productTitle: productMap.get(String(r.productId))?.title ?? '',
        productSlug: productMap.get(String(r.productId))?.slug ?? '',
      })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

adminReviewsRouter.patch(
  '/:id',
  validate(
    z.object({
      status: z.enum(['approved', 'pending', 'spam', 'rejected']).optional(),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      content: z.string().optional(),
      title: z.string().optional(),
      authorName: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const review = await Review.findByIdAndUpdate(param(req, 'id'), { $set: req.body }, { returnDocument: 'after' });
    if (!review) throw notFound('Review not found.');
    await recalculateRating(String(review.productId));
    res.json({ success: true, data: { ...review.toJSON(), id: String(review._id) } });
  }),
);

adminReviewsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const review = await Review.findByIdAndDelete(param(req, 'id'));
    if (!review) throw notFound('Review not found.');
    await recalculateRating(String(review.productId));
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Review requests (per product)                                       */
/* ------------------------------------------------------------------ */

adminReviewsRouter.get(
  '/requests',
  validate(z.object({ productId: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const filter: any = { reviewEnabled: true };
    if (req.query.productId) {
      const orders = (await Order.find({ 'items.productId': String(req.query.productId) }).select('_id')) as any[];
      filter._id = { $in: orders.map((o) => o._id) };
    }

    const orders = (await Order.find(filter).sort({ reviewSentAt: -1 }).limit(200)) as any[];
    const tokens = (await ReviewToken.find({ orderId: { $in: orders.map((o) => o._id) } })) as any[];

    res.json({
      success: true,
      data: orders.map((o) => ({
        orderNumber: o.orderNumber,
        customerEmail: o.customerEmail,
        customerName: `${o.billing?.firstName ?? ''} ${o.billing?.lastName ?? ''}`.trim(),
        status: o.status,
        reviewSentAt: o.reviewSentAt,
        reviewToken: o.reviewToken,
        used: tokens.find((t) => String(t.orderId) === String(o._id))?.used ?? false,
        expiresAt: tokens.find((t) => String(t.orderId) === String(o._id))?.expiresAt ?? null,
      })),
    });
  }),
);

/** Create a fresh review link for an order (admin triggered). */
adminReviewsRouter.post(
  '/requests',
  validate(z.object({ orderId: z.string() })),
  asyncHandler(async (req, res) => {
    const order = await Order.findById((req.body as { orderId: string }).orderId);
    if (!order) throw notFound('Order not found.');

    const token = `${order.orderNumber}-${Math.random().toString(36).slice(2, 12)}`;
    await ReviewToken.create({
      token,
      orderId: order._id,
      productId: order.items?.[0]?.productId ?? null,
      userId: order.userId,
      email: order.customerEmail,
      expiresAt: dayjs().add(14, 'day').toDate(),
    });

    order.reviewEnabled = true;
    order.reviewToken = token;
    await order.save();

    res.json({ success: true, data: { token } });
  }),
);
