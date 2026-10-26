import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { clearAuthCookies, setAuthCookies, signAccessToken, signRefreshToken } from '../../lib/tokens.js';
import { Order, User, type UserDoc } from '../../models/index.js';
import { getCancellationEligibility, requestCancellation } from '../../services/order.service.js';
import { renderInvoice } from '../../services/invoice.service.js';
import { readSecureTicket } from '../../services/ticket.service.js';
import { getSiteSettings } from '../../services/settings.service.js';

export const accountRouter = Router();

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

accountRouter.post(
  '/auth/register',
  authLimiter,
  validate(
    z.object({
      email: z.string().email('Enter a valid email address'),
      password: passwordSchema,
      firstName: z.string().min(1, 'First name is required'),
      lastName: z.string().min(1, 'Last name is required'),
      phone: z.string().optional(),
      marketingOptIn: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      phone?: string;
      marketingOptIn?: boolean;
    };

    const existing = await User.findOne({ email: body.email.toLowerCase() });
    if (existing) {
      throw badRequest('An account with this email already exists. Try logging in instead.');
    }

    const user = await User.create({
      email: body.email.toLowerCase(),
      passwordHash: await bcrypt.hash(body.password, 12),
      firstName: body.firstName,
      lastName: body.lastName,
      displayName: `${body.firstName} ${body.lastName}`,
      phone: body.phone,
      marketingOptIn: body.marketingOptIn ?? false,
    });

    const token = signAccessToken({ sub: String(user._id), email: user.email, role: user.role, name: user.displayName ?? undefined });
    const refresh = signRefreshToken({ sub: String(user._id), email: user.email, role: user.role });
    setAuthCookies(res, token, refresh);

    res.status(201).json({
      success: true,
      data: { token, user: publicUser(user) },
    });
  }),
);

accountRouter.post(
  '/auth/login',
  authLimiter,
  validate(
    z.object({
      email: z.string().email('Enter a valid email address'),
      password: z.string().min(1, 'Password is required'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = (await User.findOne({ email: email.toLowerCase() }).select('+passwordHash')) as UserDoc | null;

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw unauthorized('That email and password combination is not correct.');
    }
    if (!user.isActive) throw forbidden('This account has been disabled. Please contact support.');

    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount ?? 0) + 1;
    await user.save();

    const token = signAccessToken({ sub: String(user._id), email: user.email, role: user.role, name: user.displayName ?? undefined });
    const refresh = signRefreshToken({ sub: String(user._id), email: user.email, role: user.role });
    setAuthCookies(res, token, refresh);

    res.json({ success: true, data: { token, user: publicUser(user) } });
  }),
);

accountRouter.post('/auth/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ success: true, data: { loggedOut: true } });
});

accountRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('Account not found.');
    res.json({ success: true, data: publicUser(user) });
  }),
);

/* ------------------------------------------------------------------ */
/* Profile                                                            */
/* ------------------------------------------------------------------ */

accountRouter.patch(
  '/account',
  requireAuth,
  validate(
    z.object({
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      displayName: z.string().optional(),
      phone: z.string().optional(),
      locale: z.string().optional(),
      currency: z.string().optional(),
      marketingOptIn: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = (await User.findById(req.user!.id)) as UserDoc;
    Object.assign(user, req.body);
    if (!req.body.displayName && (req.body.firstName || req.body.lastName)) {
      user.displayName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    }
    await user.save();
    res.json({ success: true, data: publicUser(user) });
  }),
);

accountRouter.post(
  '/account/password',
  requireAuth,
  authLimiter,
  validate(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    }),
  ),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const user = (await User.findById(req.user!.id).select('+passwordHash')) as UserDoc;
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw badRequest('Your current password is not correct.');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ success: true, data: { updated: true } });
  }),
);

accountRouter.put(
  '/account/addresses',
  requireAuth,
  validate(
    z.object({
      billing: z
        .object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          postcode: z.string().optional(),
          country: z.string().optional(),
          phone: z.string().optional(),
        })
        .optional(),
      shipping: z
        .object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          postcode: z.string().optional(),
          country: z.string().optional(),
          phone: z.string().optional(),
        })
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = (await User.findById(req.user!.id)) as UserDoc;
    const body = req.body as { billing?: Record<string, unknown>; shipping?: Record<string, unknown> };
    if (body.billing) user.billingAddress = body.billing as never;
    if (body.shipping) user.shippingAddress = body.shipping as never;
    await user.save();
    res.json({ success: true, data: publicUser(user) });
  }),
);

/* ------------------------------------------------------------------ */
/* Orders                                                             */
/* ------------------------------------------------------------------ */

accountRouter.get(
  '/account/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const { skip } = paginate({}, page, limit);

    const filter: any = { $or: [{ userId: req.user!.id }, { customerEmail: req.user!.email }] };

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
        total: o.total,
        currency: o.currency,
        createdAt: o.createdAt,
        itemCount: o.items?.length ?? 0,
        firstItemTitle: o.items?.[0]?.productTitle ?? '',
        firstItemImage: o.items?.[0]?.productImage ?? '',
      })),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

accountRouter.get(
  '/account/orders/:orderNumber',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: param(req, 'orderNumber') });
    if (!order) throw notFound('Order not found.');
    if (String(order.userId) !== req.user!.id && order.customerEmail !== req.user!.email) {
      throw forbidden('This order belongs to another account.');
    }

    const eligibility = await getCancellationEligibility(order);

    res.json({
      success: true,
      data: {
        ...order.toJSON(),
        id: String(order._id),
        cancellation: eligibility,
      },
    });
  }),
);

accountRouter.post(
  '/account/orders/:orderNumber/cancel',
  requireAuth,
  validate(z.object({ reason: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: param(req, 'orderNumber') });
    if (!order) throw notFound('Order not found.');
    if (String(order.userId) !== req.user!.id && order.customerEmail !== req.user!.email) {
      throw forbidden('This order belongs to another account.');
    }

    await requestCancellation(
      String(order._id),
      req.user!.id,
      (req.body as { reason?: string }).reason ?? '',
    );

    res.json({ success: true, data: { cancelRequested: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Downloads                                                          */
/* ------------------------------------------------------------------ */

accountRouter.get(
  '/account/orders/:orderNumber/invoice',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: param(req, 'orderNumber') });
    if (!order) throw notFound('Order not found.');
    if (String(order.userId) !== req.user!.id && order.customerEmail !== req.user!.email) {
      throw forbidden('This order belongs to another account.');
    }

    const { filename, buffer } = await renderInvoice(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

accountRouter.get(
  '/account/orders/:orderNumber/tickets/:index',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderNumber: param(req, 'orderNumber') });
    if (!order) throw notFound('Order not found.');
    if (String(order.userId) !== req.user!.id && order.customerEmail !== req.user!.email) {
      throw forbidden('This order belongs to another account.');
    }

    const index = Number(param(req, 'index'));
    const filePath = order.ticketFiles?.[index];
    if (!filePath) throw notFound('Ticket not found.');

    const { buffer, filename, mime } = await readSecureTicket(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

/* ------------------------------------------------------------------ */

export function publicUser(user: UserDoc) {
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    addresses: user.addresses ?? [],
    billingAddress: user.billingAddress,
    shippingAddress: user.shippingAddress,
    orderCount: user.orderCount ?? 0,
    totalSpent: user.totalSpent ?? 0,
    createdAt: user.createdAt,
    marketingOptIn: user.marketingOptIn,
    siteCurrency: (user.currency ?? 'EUR'),
  };
}

export { getSiteSettings };
