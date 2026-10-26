import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import bcrypt from 'bcryptjs';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { badRequest, notFound } from '../../lib/errors.js';
import {
  Coupon,
  Media,
  Message,
  Order,
  Product,
  Review,
  User,
  type UserDoc,
} from '../../models/index.js';
import { saveSecureTicket, isAllowedTicketExtension } from '../../services/ticket.service.js';
import { publicUser } from '../public/account.routes.js';

export const adminMiscRouter = Router();

/* ------------------------------------------------------------------ */
/* Dashboard                                                          */
/* ------------------------------------------------------------------ */

adminMiscRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const now = dayjs();
    const startOfMonth = now.startOf('month');
    const startOfDay = now.startOf('day');

    const [
      totalOrders,
      ordersToday,
      revenueAgg,
      revenueToday,
      pendingOrders,
      reviewCount,
      reviewAvg,
      productCount,
      customerCount,
      fraudReviewCount,
      lastOrders,
      revenueSeries,
      topProducts,
    ] = await Promise.all([
      Order.countDocuments({}),
      Order.countDocuments({ createdAt: { $gte: startOfDay.toDate() } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfMonth.toDate() }, status: { $nin: ['cancelled', 'failed', 'refunded'] } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfDay.toDate() }, status: { $nin: ['cancelled', 'failed', 'refunded'] } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Order.countDocuments({ status: { $in: ['pending', 'on-hold', 'fraud-review'] } }),
      Review.countDocuments({ status: 'approved' }),
      Review.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]),
      Product.countDocuments({ status: 'publish' }),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments({ 'fraud.level': { $in: ['review', 'blocked'] } }),
      Order.find().sort({ createdAt: -1 }).limit(8),
      Order.aggregate([
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ]),
      Order.aggregate([
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            title: { $first: '$items.productTitle' },
            revenue: { $sum: '$items.total' },
            sold: { $sum: '$items.travelerCount' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 8 },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          totalOrders,
          ordersToday,
          revenueMonth: revenueAgg[0]?.total ?? 0,
          revenueToday: revenueToday[0]?.total ?? 0,
          ordersMonth: revenueAgg[0]?.count ?? 0,
          pendingOrders,
          reviews: reviewCount,
          averageRating: reviewAvg[0]?.avg ? Math.round(reviewAvg[0].avg * 10) / 10 : 0,
          products: productCount,
          customers: customerCount,
          fraudReview: fraudReviewCount,
        },
        recentOrders: lastOrders.map((o) => ({
          id: String(o._id),
          orderNumber: o.orderNumber,
          status: o.status,
          total: o.total,
          customerEmail: o.customerEmail,
          createdAt: o.createdAt,
        })),
        revenueSeries: revenueSeries.map((r) => ({ date: r._id, revenue: r.revenue, orders: r.orders })),
        topProducts: topProducts.map((p) => ({ id: p._id, title: p.title, revenue: p.revenue, sold: p.sold })),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Users                                                              */
/* ------------------------------------------------------------------ */

adminMiscRouter.get(
  '/users',
  validate(
    z.object({
      search: z.string().optional(),
      role: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { search?: string; role?: string; page?: number; limit?: number };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 25);

    const filter: any = {};
    if (q.role && q.role !== 'any') filter.role = q.role;
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: users.map((u) => publicUser(u as UserDoc)),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

adminMiscRouter.patch(
  '/users/:id',
  validate(
    z.object({
      role: z.enum(['customer', 'manager', 'admin']).optional(),
      isActive: z.boolean().optional(),
      emailVerified: z.boolean().optional(),
      notes: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(param(req, 'id'), { $set: req.body }, { returnDocument: 'after' });
    if (!user) throw notFound('User not found.');
    res.json({ success: true, data: publicUser(user as UserDoc) });
  }),
);

adminMiscRouter.post(
  '/users/:id/password',
  validate(z.object({ password: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const user = await User.findById(param(req, 'id'));
    if (!user) throw notFound('User not found.');
    user.passwordHash = await bcrypt.hash((req.body as { password: string }).password, 12);
    await user.save();
    res.json({ success: true, data: { updated: true } });
  }),
);

adminMiscRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndDelete(param(req, 'id'));
    if (!user) throw notFound('User not found.');
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Coupons                                                            */
/* ------------------------------------------------------------------ */

adminMiscRouter.get(
  '/coupons',
  asyncHandler(async (_req, res) => {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json({ success: true, data: coupons.map((c) => ({ ...c.toJSON(), id: String(c._id) })) });
  }),
);

adminMiscRouter.post(
  '/coupons',
  validate(
    z.object({
      code: z.string().min(2),
      type: z.enum(['fixed_cart', 'percent', 'fixed_product']).optional(),
      amount: z.coerce.number().min(0),
      description: z.string().optional(),
      dateExpires: z.string().optional(),
      usageLimit: z.coerce.number().min(0).optional(),
      usageLimitPerUser: z.coerce.number().min(0).optional(),
      minimumAmount: z.coerce.number().min(0).optional(),
      maximumAmount: z.coerce.number().min(0).optional(),
      individualUse: z.boolean().optional(),
      freeShipping: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const coupon = await Coupon.create({
      ...body,
      code: String(body.code).toUpperCase(),
      dateExpires: body.dateExpires ? new Date(body.dateExpires as string) : undefined,
    });
    res.status(201).json({ success: true, data: { ...coupon.toJSON(), id: String(coupon._id) } });
  }),
);

adminMiscRouter.put(
  '/coupons/:id',
  validate(
    z.object({
      code: z.string().min(2).optional(),
      type: z.enum(['fixed_cart', 'percent', 'fixed_product']).optional(),
      amount: z.coerce.number().min(0).optional(),
      description: z.string().optional(),
      dateExpires: z.string().optional(),
      usageLimit: z.coerce.number().min(0).optional(),
      minimumAmount: z.coerce.number().min(0).optional(),
      maximumAmount: z.coerce.number().min(0).optional(),
      active: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.code) body.code = String(body.code).toUpperCase();
    if (body.dateExpires) body.dateExpires = new Date(body.dateExpires as string);
    const coupon = await Coupon.findByIdAndUpdate(param(req, 'id'), { $set: body }, { returnDocument: 'after' });
    if (!coupon) throw notFound('Coupon not found.');
    res.json({ success: true, data: { ...coupon.toJSON(), id: String(coupon._id) } });
  }),
);

adminMiscRouter.delete(
  '/coupons/:id',
  asyncHandler(async (req, res) => {
    const coupon = await Coupon.findByIdAndDelete(param(req, 'id'));
    if (!coupon) throw notFound('Coupon not found.');
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Media                                                              */
/* ------------------------------------------------------------------ */

adminMiscRouter.post(
  '/media',
  validate(
    z.object({
      filename: z.string().min(1),
      content: z.string().min(1),
      alt: z.string().optional(),
      secure: z.boolean().optional(),
      orderId: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { filename: string; content: string; alt?: string; secure?: boolean; orderId?: string };

    const base64 = body.content.includes(',') ? body.content.split(',').pop()! : body.content;
    const buffer = Buffer.from(base64, 'base64');

    if (body.secure) {
      if (!isAllowedTicketExtension(body.filename)) {
        throw badRequest('Tickets must be PDF or image files.');
      }
      const order = body.orderId ? await Order.findById(body.orderId) : null;
      const orderNumber = order?.orderNumber ?? 'unassigned';
      const path = await saveSecureTicket(buffer, body.filename, orderNumber);

      if (order) {
        order.ticketFiles = [...(order.ticketFiles ?? []), path];
        await order.save();
      }

      const media = await Media.create({
        filename: body.filename,
        originalName: body.filename,
        mimeType: 'application/octet-stream',
        size: buffer.length,
        url: path,
        path,
        alt: body.alt ?? '',
        isSecure: true,
      });

      res.status(201).json({ success: true, data: { ...media.toJSON(), id: String(media._id) } });
      return;
    }

    const { writePublicFile, publicMime } = await import('../../services/media.service.js');
    const stored = await writePublicFile(buffer, body.filename);
    const media = await Media.create({
      filename: stored,
      originalName: body.filename,
      mimeType: publicMime(stored),
      size: buffer.length,
      url: `/media/${stored}`,
      path: stored,
      alt: body.alt ?? '',
      isSecure: false,
    });

    res.status(201).json({ success: true, data: { ...media.toJSON(), id: String(media._id), base64: buffer.toString('base64') } });
  }),
);

adminMiscRouter.get(
  '/media',
  asyncHandler(async (_req, res) => {
    const media = await Media.find().sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: media.map((m) => ({ ...m.toJSON(), id: String(m._id) })) });
  }),
);

adminMiscRouter.delete(
  '/media/:id',
  asyncHandler(async (req, res) => {
    const media = await Media.findByIdAndDelete(param(req, 'id'));
    if (!media) throw notFound('Media not found.');
    if (!media.isSecure && media.path) {
      const { removePublicFile } = await import('../../services/media.service.js');
      await removePublicFile(media.path).catch(() => undefined);
    }
    res.json({ success: true, data: { deleted: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Messages                                                           */
/* ------------------------------------------------------------------ */

adminMiscRouter.get(
  '/messages',
  validate(
    z.object({
      type: z.enum(['contact', 'newsletter', 'any']).optional(),
      handled: z.enum(['1', '0', 'any']).optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type?: string; handled?: string; page?: number; limit?: number };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 25);

    const filter: any = {};
    if (q.type && q.type !== 'any') filter.type = q.type;
    if (q.handled && q.handled !== 'any') filter.handled = q.handled === '1';

    const [total, messages] = await Promise.all([
      Message.countDocuments(filter),
      Message.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: messages.map((m) => ({ ...m.toJSON(), id: String(m._id) })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

adminMiscRouter.patch(
  '/messages/:id',
  validate(z.object({ handled: z.boolean() })),
  asyncHandler(async (req, res) => {
    const message = await Message.findByIdAndUpdate(param(req, 'id'), { $set: req.body }, { returnDocument: 'after' });
    if (!message) throw notFound('Message not found.');
    res.json({ success: true, data: { ...message.toJSON(), id: String(message._id) } });
  }),
);

adminMiscRouter.delete(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const message = await Message.findByIdAndDelete(param(req, 'id'));
    if (!message) throw notFound('Message not found.');
    res.json({ success: true, data: { deleted: true } });
  }),
);
