import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { notFound } from '../../lib/errors.js';
import { FraudEvent, Order } from '../../models/index.js';
import {
  getFraudSettings,
  saveFraudSettings,
  type FraudSettings,
} from '../../services/settings.service.js';
import { rescanOrders, recordFraudEvent } from '../../services/fraud.service.js';

export const adminFraudRouter = Router();

const fraudSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  reviewThreshold: z.coerce.number().min(0).max(100).optional(),
  blockThreshold: z.coerce.number().min(0).max(100).optional(),
  velocityWindowMinutes: z.coerce.number().min(1).optional(),
  maxIpAttempts: z.coerce.number().min(0).optional(),
  maxFingerprintAttempts: z.coerce.number().min(0).optional(),
  maxEmailAttempts: z.coerce.number().min(0).optional(),
  duplicateWindowMinutes: z.coerce.number().min(1).optional(),
  duplicateProductLimit: z.coerce.number().min(0).optional(),
  blockedIps: z.array(z.string()).optional(),
  blockedEmails: z.array(z.string()).optional(),
  blockedFingerprints: z.array(z.string()).optional(),
  blockedDomains: z.array(z.string()).optional(),
  disposableDomains: z.array(z.string()).optional(),
  turnstileSiteKey: z.string().optional(),
  turnstileSecretKey: z.string().optional(),
  turnstileMode: z.enum(['off', 'managed', 'invisible']).optional(),
  fpjsPublicApiKey: z.string().optional(),
  fpjsRegion: z.string().optional(),
});

adminFraudRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await getFraudSettings() });
  }),
);

adminFraudRouter.put(
  '/settings',
  validate(fraudSettingsSchema),
  asyncHandler(async (req, res) => {
    const current = await getFraudSettings();
    const next: FraudSettings = { ...current, ...(req.body as Partial<FraudSettings>) };
    // Never let the block threshold sit below the review threshold.
    if (next.blockThreshold < next.reviewThreshold) next.blockThreshold = next.reviewThreshold;
    await saveFraudSettings(next);
    res.json({ success: true, data: next });
  }),
);

/* ------------------------------------------------------------------ */
/* Blocklist quick actions                                            */
/* ------------------------------------------------------------------ */

adminFraudRouter.post(
  '/blocklist',
  validate(
    z.object({
      type: z.enum(['ip', 'email', 'fingerprint', 'domain']),
      value: z.string().min(1),
      action: z.enum(['add', 'remove']).default('add'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { type, value, action } = req.body as { type: string; value: string; action: 'add' | 'remove' };
    const settings = await getFraudSettings();

    const map: Record<string, { list: string[]; set: (v: string[]) => FraudSettings }> = {
      ip: { list: settings.blockedIps, set: (v) => ({ ...settings, blockedIps: v }) },
      email: { list: settings.blockedEmails, set: (v) => ({ ...settings, blockedEmails: v }) },
      fingerprint: { list: settings.blockedFingerprints, set: (v) => ({ ...settings, blockedFingerprints: v }) },
      domain: { list: settings.blockedDomains, set: (v) => ({ ...settings, blockedDomains: v }) },
    };

    const entry = map[type];
    if (!entry) throw notFound('Unknown blocklist type.');

    const normalised = value.trim().toLowerCase();
    const next = action === 'add' ? Array.from(new Set([...entry.list, normalised])) : entry.list.filter((v) => v !== normalised);

    await saveFraudSettings(entry.set(next));
    res.json({ success: true, data: { type, value: normalised, action, count: next.length } });
  }),
);

/* ------------------------------------------------------------------ */
/* Audit trail                                                        */
/* ------------------------------------------------------------------ */

adminFraudRouter.get(
  '/events',
  validate(
    z.object({
      status: z.string().optional(),
      eventType: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { status?: string; eventType?: string; page?: number; limit?: number };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 25);

    const filter: any = {};
    if (q.status && q.status !== 'any') filter.status = q.status;
    if (q.eventType && q.eventType !== 'any') filter.eventType = q.eventType;

    const [total, events] = await Promise.all([
      FraudEvent.countDocuments(filter),
      FraudEvent.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: events.map((e) => ({ ...e.toJSON(), id: String(e._id) })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Order-level actions                                                */
/* ------------------------------------------------------------------ */

adminFraudRouter.get(
  '/orders',
  validate(
    z.object({
      level: z.enum(['allowed', 'review', 'blocked', 'any']).optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { level?: string; page?: number; limit?: number };
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 25);

    const filter: any = {};
    if (q.level && q.level !== 'any') filter['fraud.level'] = q.level;

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: orders.map((o) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        status: o.status,
        customerEmail: o.customerEmail,
        total: o.total,
        fraud: o.fraud,
        createdAt: o.createdAt,
      })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

adminFraudRouter.patch(
  '/orders/:id',
  validate(
    z.object({
      level: z.enum(['allowed', 'review', 'blocked']).optional(),
      reviewed: z.boolean().optional(),
      reasons: z.array(z.string()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');

    const body = req.body as { level?: 'allowed' | 'review' | 'blocked'; reviewed?: boolean; reasons?: string[] };
    if (body.level) order.fraud.level = body.level;
    if (body.reasons) order.fraud.reasons = body.reasons;
    if (body.reviewed !== undefined) order.fraud.reviewed = body.reviewed;
    await order.save();

    await recordFraudEvent({
      eventType: 'manual.review',
      orderId: String(order._id),
      status: order.fraud.level ?? 'allowed',
      riskScore: order.fraud.score ?? 0,
      ipHash: order.fraud.ipHash ?? undefined,
      emailHash: order.fraud.emailHash ?? undefined,
      reasons: order.fraud.reasons,
    });

    res.json({ success: true, data: { id: String(order._id), fraud: order.fraud } });
  }),
);

adminFraudRouter.post(
  '/rescan',
  validate(z.object({ onlyRisky: z.boolean().optional(), limit: z.coerce.number().optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as { onlyRisky?: boolean; limit?: number };
    const result = await rescanOrders({ onlyRisky: body.onlyRisky, limit: body.limit });
    res.json({ success: true, data: result });
  }),
);
