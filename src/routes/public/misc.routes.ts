import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { Order, Product, Review, ReviewToken, Message } from '../../models/index.js';
import { getSiteSettings, getPromoSettings, getFomoSettings } from '../../services/settings.service.js';
import { presentProduct } from '../../lib/presenters.js';
import { emailContactMessage, emailNewsletterWelcome } from '../../services/email.service.js';
import { hashValue } from '../../services/fraud.service.js';

export const miscRouter = Router();

/* ------------------------------------------------------------------ */
/* Public settings                                                    */
/* ------------------------------------------------------------------ */

miscRouter.get(
  '/settings/public',
  asyncHandler(async (_req, res) => {
    const [site, promo, fomo] = await Promise.all([getSiteSettings(), getPromoSettings(), getFomoSettings()]);

    let promoProducts: Record<string, unknown>[] = [];
    if (promo.showBanner) {
      const filter: Record<string, unknown> = { status: 'publish' };
      if (promo.productType === 'category' && promo.category.length) {
        filter.categoryIds = { $in: promo.category.filter((id) => Types.ObjectId.isValid(id)) };
      } else if (promo.productType === 'tag' && promo.tag.length) {
        filter.tagIds = { $in: promo.tag.filter((id) => Types.ObjectId.isValid(id)) };
      } else if (promo.productType === 'products' && promo.productIds.length) {
        filter._id = { $in: promo.productIds.filter((id) => Types.ObjectId.isValid(id)) };
      }
      const docs = await Product.find(filter).sort({ bookingCount: -1 }).limit(10);
      promoProducts = docs.map((doc) => presentProduct(doc));
    }

    let fomoEntries: { person: string; country: string; product: { title: string; image: string; slug: string } }[] = [];
    if (fomo.enabled && fomo.entries.length) {
      const ids = Array.from(
        new Set(fomo.entries.flatMap((entry) => entry.productIds ?? []).filter((id) => Types.ObjectId.isValid(id))),
      );
      const docs = await Product.find({ _id: { $in: ids }, status: 'publish' }).select('slug title images');
      const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
      fomoEntries = fomo.entries.flatMap((entry) => {
        const product = (entry.productIds ?? []).map((id) => byId.get(id)).find(Boolean);
        if (!product) return [];
        return [
          {
            person: entry.person,
            country: entry.country || 'US',
            product: {
              title: product.title,
              image: product.images?.[0]?.url ?? '',
              slug: product.slug,
            },
          },
        ];
      });
    }

    res.json({
      success: true,
      data: {
        siteName: site.siteName,
        currency: site.currency,
        currencySymbol: site.currencySymbol,
        socials: site.socials,
        analytics: site.analytics,
        seo: site.seo,
        booking: site.booking,
        promo: { ...promo, products: promoProducts },
        fomoEnabled: fomo.enabled,
        fomo: { enabled: fomo.enabled, entries: fomoEntries },
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Order tracking                                                     */
/* ------------------------------------------------------------------ */

const STAGES = ['received', 'processing', 'confirm', 'completed', 'canceled', 'refunded'] as const;

const STAGE_LABELS: Record<string, { label: string; message: string }> = {
  canceled: {
    label: 'Booking Cancelled',
    message: "Unfortunately, we couldn't confirm your booking. A full refund has been issued.",
  },
  refunded: { label: 'Refunded', message: 'Your booking has been refunded and cancelled.' },
  received: {
    label: 'Received',
    message: "We've received your booking request and are confirming your ticket with our partner.",
  },
  processing: {
    label: 'On Processing',
    message: "Your booking is currently being processed by our team.",
  },
  confirm: {
    label: 'Booking Confirmed',
    message: 'Your booking has been successfully confirmed. Your tickets are on the way.',
  },
  completed: {
    label: 'Booking Completed',
    message: 'Your tickets have been delivered. We hope you have an amazing trip!',
  },
};

function stageForStatus(status: string): (typeof STAGES)[number] {
  switch (status) {
    case 'failed':
    case 'cancelled':
      return 'canceled';
    case 'refunded':
      return 'refunded';
    case 'on-hold':
      return 'received';
    case 'processing':
      return 'processing';
    case 'booking-confirm':
      return 'confirm';
    case 'completed':
      return 'completed';
    default:
      return 'received';
  }
}

miscRouter.get(
  '/track/:orderNumber',
  asyncHandler(async (req, res) => {
    const orderNumber = param(req, 'orderNumber');
    if (!orderNumber || orderNumber.length < 3) throw notFound('We could not find an order with that number.');
    const order = await Order.findOne({ orderNumber }).select(
      'orderNumber status createdAt total currency items customerEmail billing fraud reviewEnabled reviewSentAt',
    );
    if (!order) throw notFound('We could not find an order with that number.');

    const stage = stageForStatus(order.status);
    const stageIndex = STAGES.indexOf(stage);
    const info = STAGE_LABELS[stage];

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        stage,
        stageIndex,
        stages: STAGES,
        label: info.label,
        message: info.message,
        createdAt: order.createdAt,
        total: order.total,
        currency: order.currency,
        customerName: order.billing?.firstName ?? '',
        items: (order.items ?? []).map((i) => ({
          productTitle: i.productTitle,
          productImage: i.productImage,
          optionName: i.optionName,
          date: i.date,
          time: i.time,
          travelerCount: i.travelerCount,
          total: i.total,
        })),
        needsReview: order.status === 'completed' && order.reviewEnabled && !order.reviewSentAt,
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Reviews                                                            */
/* ------------------------------------------------------------------ */

miscRouter.get(
  '/products/:productId/reviews',
  validate(
    z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const productId = param(req, 'productId');
    const { skip, limit, page } = paginate({}, Number(req.query.page) || 1, Number(req.query.limit) || 5);

    const filter = { productId, status: 'approved' as const };
    const [total, reviews, agg] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Review.aggregate([
        { $match: { productId: new Types.ObjectId(productId), status: 'approved' } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
    ]);

    const counts: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let average = 0;
    let rated = 0;
    for (const row of agg) {
      counts[String(row._id)] = row.count;
      average += row._id * row.count;
      rated += row.count;
    }

    res.json({
      success: true,
      data: reviews.map((r) => ({
        id: String(r._id),
        authorName: r.authorName,
        authorAvatar: r.authorAvatar,
        rating: r.rating,
        title: r.title,
        content: r.content,
        verifiedBooking: r.verifiedBooking,
        images: r.images,
        createdAt: r.createdAt,
      })),
      summary: { total, rated, average: rated ? Math.round((average / rated) * 10) / 10 : 0, counts },
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

miscRouter.post(
  '/reviews/submit',
  authLimiter,
  validate(
    z.object({
      token: z.string().min(10),
      rating: z.coerce.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      content: z.string().min(10, 'Please tell us a little more').max(4000),
      authorName: z.string().max(120).optional(),
      authorEmail: z.string().email().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      token: string;
      rating: number;
      title?: string;
      content: string;
      authorName?: string;
      authorEmail?: string;
    };

    const reviewToken = await ReviewToken.findOne({ token: body.token });
    if (!reviewToken) throw notFound('This review link is not valid.');
    if (reviewToken.used) throw badRequest('This review link has already been used.');
    if (reviewToken.expiresAt.getTime() < Date.now()) throw badRequest('This review link has expired.');

    const order = await Order.findById(reviewToken.orderId);
    if (!order) throw notFound('The order behind this review link no longer exists.');

    const productId = reviewToken.productId ?? order.items?.[0]?.productId;
    if (!productId) throw badRequest('We could not work out which product this review is for.');

    const product = await Product.findById(productId);
    const authorName = body.authorName?.trim() || order.billing?.firstName || 'Traveller';
    const authorEmail = body.authorEmail?.toLowerCase() || order.customerEmail;

    await Review.create({
      productId,
      userId: order.userId,
      orderId: order._id,
      authorName,
      authorEmail,
      rating: body.rating,
      title: body.title ?? '',
      content: body.content,
      status: 'approved',
      source: 'customer',
      verifiedBooking: true,
      ipHash: hashValue(authorEmail),
    });

    reviewToken.used = true;
    reviewToken.usedAt = new Date();
    await reviewToken.save();

    await Product.updateOne(
      { _id: new Types.ObjectId(String(productId)) },
      { $inc: { 'rating.count': 1, 'rating.rated': 1 } },
    );
    await recalculateRating(String(productId));

    res.status(201).json({ success: true, data: { submitted: true, productTitle: product?.title ?? '' } });
  }),
);

/** Recompute the cached average rating for a product. */
export async function recalculateRating(productId: string) {
  const rows = await Review.aggregate([
    { $match: { productId: new Types.ObjectId(String(productId)), status: 'approved' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let total = 0;
  for (const row of rows) {
    counts[row._id as 1 | 2 | 3 | 4 | 5] = row.count;
    sum += row._id * row.count;
    total += row.count;
  }
  const average = total ? Math.round((sum / total) * 10) / 10 : 0;
  await Product.updateOne({ _id: productId }, { $set: { 'rating.average': average, 'rating.counts': counts } });
}

/* ------------------------------------------------------------------ */
/* Contact & newsletter                                                */
/* ------------------------------------------------------------------ */

miscRouter.post(
  '/contact',
  authLimiter,
  validate(
    z.object({
      name: z.string().min(1, 'Your name is required'),
      email: z.string().email('Enter a valid email address'),
      subject: z.string().max(200).optional(),
      message: z.string().min(10, 'Please add a little more detail').max(4000),
      website: z.string().max(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { name: string; email: string; subject?: string; message: string };

    await Message.create({
      type: 'contact',
      name: body.name,
      email: body.email.toLowerCase(),
      subject: body.subject ?? 'New enquiry',
      message: body.message,
    });

    await emailContactMessage(body.name, body.email, body.subject ?? 'New enquiry', body.message);

    res.status(201).json({ success: true, data: { received: true } });
  }),
);

miscRouter.post(
  '/newsletter',
  authLimiter,
  validate(z.object({ email: z.string().email('Enter a valid email address') })),
  asyncHandler(async (req, res) => {
    const email = (req.body as { email: string }).email.toLowerCase();
    const existing = await Message.findOne({ type: 'newsletter', email });
    if (!existing) {
      await Message.create({ type: 'newsletter', email });
      await emailNewsletterWelcome(email);
    }
    res.status(201).json({ success: true, data: { subscribed: true } });
  }),
);
