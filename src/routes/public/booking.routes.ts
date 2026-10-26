import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { cartSession, currentCart } from '../../middleware/cartSession.js';
import { authLimiter, checkoutLimiter } from '../../middleware/rateLimit.js';
import { badRequest } from '../../lib/errors.js';
import { Product } from '../../models/index.js';
import { availabilityCalendar, dayAvailability } from '../../services/availability.service.js';
import { quoteBooking } from '../../services/pricing.service.js';
import {
  addItem,
  applySlotDecrement,
  buildCartView,
  commitCart,
  removeItem,
  setExtras,
  setTravelerCount,
  updateItemTravelers,
  validateCoupon,
} from '../../services/cart.service.js';
import { createOrder } from '../../services/order.service.js';
import { getCheckoutSettings, getFraudSettings } from '../../services/settings.service.js';
import { verifyTurnstile } from '../../services/fraud.service.js';

export const bookingRouter = Router();

/* ------------------------------------------------------------------ */
/* Availability                                                       */
/* ------------------------------------------------------------------ */

bookingRouter.get(
  '/availability/:productId',
    validate(
      z.object({
        option: z.coerce.number().int().min(0).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }).passthrough(),
      'query',
    ),
  asyncHandler(async (req, res) => {
    const { productId } = req.params as any;
    if (!/^[0-9a-fA-F]{24}$/.test(productId)) throw badRequest('Product not found.');
    const query = req.query as any;
    const option = Number(query.option ?? 0);
    const from = query.from;
    const to = query.to;

    const product = await Product.findById(productId);
    if (!product) throw badRequest('Product not found.');
    if (product.status !== 'publish') throw badRequest('This product is not available for booking.');

    const today = new Date().toISOString().slice(0, 10);
    const fromStrRaw: any = Array.isArray(from) ? from[0] : from;
    const toStrRaw: any = Array.isArray(to) ? to[0] : to;
    const fromStr = typeof fromStrRaw === 'string' ? fromStrRaw : (typeof fromStrRaw === 'number' ? String(fromStrRaw) : undefined);
    const toStr = typeof toStrRaw === 'string' ? toStrRaw : (typeof toStrRaw === 'number' ? String(toStrRaw) : undefined);
    const startVal: string = fromStr && fromStr >= today ? fromStr : today;
    const endDefault = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const endVal: string = toStr && toStr >= startVal ? toStr : endDefault;

    // @ts-ignore
    const calendar = (availabilityCalendar as any)(product, option, startVal, endVal);

    res.json({
      success: true,
      data: {
        productId,
        option,
        from: startVal,
        to: endVal,
        calendar,
        availableDates: (calendar as any[]).filter((d: any) => d.available).map((d: any) => d.date),
      },
    });
  }),
);

bookingRouter.get(
  '/availability/:productId/day/:date',
  validate(z.object({ option: z.coerce.number().int().min(0).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const productId = param(req, 'productId');
    if (!/^[0-9a-fA-F]{24}$/.test(productId)) throw badRequest('Product not found.');
    const product = await Product.findById(productId);
    if (!product) throw badRequest('Product not found.');
    if (product.status !== 'publish') throw badRequest('This product is not available for booking.');
    const option = Number(req.query.option ?? 0);
    res.json({ success: true, data: dayAvailability(product, option, param(req, 'date')) });
  }),
);

/* ------------------------------------------------------------------ */
/* Price quote                                                        */
/* ------------------------------------------------------------------ */

const quoteSchema = z.object({
  productId: z.string().min(1),
  optionIndex: z.coerce.number().int().min(0).default(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().optional(),
  travelers: z
    .object({
      Adult: z.coerce.number().int().min(0).optional(),
      Child: z.coerce.number().int().min(0).optional(),
      Infant: z.coerce.number().int().min(0).optional(),
      Youth: z.coerce.number().int().min(0).optional(),
      Senior: z.coerce.number().int().min(0).optional(),
    })
    .default({ Adult: 1 }),
});

bookingRouter.post(
  '/quote',
  validate(quoteSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof quoteSchema>;
    if (!/^[0-9a-fA-F]{24}$/.test(body.productId)) throw badRequest('Product not found.');
    const product = await Product.findById(body.productId);
    if (!product) throw badRequest('Product not found.');
    if (product.status !== 'publish') throw badRequest('This product is not available for booking.');

    const quote = quoteBooking({
      product,
      optionIndex: body.optionIndex,
      date: body.date,
      time: body.time,
      travelers: body.travelers,
    });

    res.json({ success: true, data: quote });
  }),
);

/* ------------------------------------------------------------------ */
/* Cart                                                               */
/* ------------------------------------------------------------------ */

bookingRouter.use(cartSession);

bookingRouter.get(
  '/cart',
  asyncHandler(async (_req, res) => {
    const cart = currentCart(res);
    res.json({ success: true, data: await buildCartView(cart) });
  }),
);

bookingRouter.post(
  '/cart/items',
  validate(
    z.object({
      productId: z.string().min(1),
      optionIndex: z.coerce.number().int().min(0).default(0),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().optional(),
      language: z.string().optional(),
      travelers: z
        .object({
          Adult: z.coerce.number().int().min(0).optional(),
          Child: z.coerce.number().int().min(0).optional(),
          Infant: z.coerce.number().int().min(0).optional(),
          Youth: z.coerce.number().int().min(0).optional(),
          Senior: z.coerce.number().int().min(0).optional(),
        })
        .default({ Adult: 1 }),
    }),
  ),
  asyncHandler(async (req, res) => {
    const cart = currentCart(res);
    const body = req.body as z.infer<typeof quoteSchema> & { language?: string };

    const { cart: updated, quote } = await addItem(cart, {
      productId: body.productId,
      optionIndex: body.optionIndex,
      date: body.date,
      time: body.time,
      language: body.language,
      travelers: body.travelers,
    });

    res.json({ success: true, data: { quote, cart: await buildCartView(updated) } });
  }),
);

bookingRouter.patch(
  '/cart/items/:key',
  validate(
    z.object({
      travelers: z.object({
        Adult: z.coerce.number().int().min(0).optional(),
        Child: z.coerce.number().int().min(0).optional(),
        Infant: z.coerce.number().int().min(0).optional(),
        Youth: z.coerce.number().int().min(0).optional(),
        Senior: z.coerce.number().int().min(0).optional(),
      }),
    }),
  ),
  asyncHandler(async (req, res) => {
    const cart = currentCart(res);
    const { cart: updated, quote } = await updateItemTravelers(
      cart,
      param(req, 'key'),
      (req.body as { travelers: Record<string, number> }).travelers,
    );
    res.json({ success: true, data: { quote, cart: await buildCartView(updated) } });
  }),
);

bookingRouter.delete(
  '/cart/items/:key',
  asyncHandler(async (req, res) => {
    const cart = currentCart(res);
    const updated = await removeItem(cart, param(req, 'key'));
    res.json({ success: true, data: await buildCartView(updated) });
  }),
);

bookingRouter.post(
  '/cart/extras',
  validate(
    z.object({
      extras: z.array(z.object({ id: z.string(), label: z.string(), price: z.coerce.number() })).default([]),
    }),
  ),
  asyncHandler(async (req, res) => {
    const cart = currentCart(res);
    const body = req.body as { extras: { id: string; label: string; price: number }[] };

    // Only allow extras that are actually configured.
    const settings = await getCheckoutSettings();
    const allowed = new Map(settings.extras.map((e) => [e.id, e]));
    const sanitized = body.extras
      .filter((e) => allowed.has(e.id))
      .map((e) => allowed.get(e.id)!);

    const updated = await setExtras(cart, sanitized);
    res.json({ success: true, data: await buildCartView(updated) });
  }),
);

bookingRouter.post(
  '/cart/traveler-count',
  validate(z.object({ travelerCount: z.coerce.number().int().min(1).max(50) })),
  asyncHandler(async (req, res) => {
    const cart = currentCart(res);
    const updated = await setTravelerCount(cart, (req.body as { travelerCount: number }).travelerCount);
    res.json({ success: true, data: await buildCartView(updated) });
  }),
);

bookingRouter.post(
  '/cart/coupon',
  validate(z.object({ code: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const cart = currentCart(res);
    const code = (req.body as { code: string }).code.trim().toUpperCase();
    const view = await buildCartView(cart);
    const result = await validateCoupon(code, view.subtotal);

    if (result.valid) {
      cart.couponCode = code;
      await cart.save();
    }

    res.json({
      success: result.valid,
      data: await buildCartView(cart),
      message: result.message,
    });
  }),
);

bookingRouter.delete(
  '/cart',
  asyncHandler(async (_req, res) => {
    const cart = currentCart(res);
    cart.items.splice(0, cart.items.length);
    cart.couponCode = '';
    cart.extras.splice(0, cart.extras.length);
    await cart.save();
    res.json({ success: true, data: await buildCartView(cart) });
  }),
);

/* ------------------------------------------------------------------ */
/* Checkout                                                           */
/* ------------------------------------------------------------------ */

bookingRouter.get(
  '/checkout/options',
  asyncHandler(async (_req, res) => {
    const [settings, fraud] = await Promise.all([getCheckoutSettings(), getFraudSettings()]);
    res.json({
      success: true,
      data: {
        ...settings,
        turnstile:
          fraud.turnstileMode !== 'off' && fraud.turnstileSiteKey
            ? { mode: fraud.turnstileMode, siteKey: fraud.turnstileSiteKey }
            : null,
      },
    });
  }),
);

const checkoutSchema = z.object({
  customer: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Enter a valid email address'),
    phone: z.string().min(6, 'A contact number is required'),
    country: z.string().optional(),
    address1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
  }),
  confirmEmail: z.string().email().optional(),
  company: z.string().max(0, 'Unexpected value').optional(),
  passengers: z
    .array(
      z.object({
        firstName: z.string().default(''),
        lastName: z.string().default(''),
        passport: z.string().optional(),
        nationality: z.string().optional(),
        passportExpiry: z.string().optional(),
        birthDate: z.string().optional(),
      }),
    )
    .default([]),
  pickupOption: z.string().optional(),
  departureOption: z.string().optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().max(2000).optional(),
  turnstileToken: z.string().optional(),
  fingerprint: z.string().optional(),
  attribution: z
    .object({
      sourceType: z.string().optional(),
      referrer: z.string().optional(),
      utmSource: z.string().optional(),
      utmMedium: z.string().optional(),
      utmCampaign: z.string().optional(),
      sessionEntry: z.string().optional(),
      sessionPages: z.coerce.number().optional(),
      deviceType: z.string().optional(),
    })
    .optional(),
});

bookingRouter.post(
  '/checkout',
  checkoutLimiter,
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof checkoutSchema>;
    const cart = currentCart(res);

    if (body.confirmEmail && body.confirmEmail.toLowerCase() !== body.customer.email.toLowerCase()) {
      throw badRequest('The confirmation email does not match your email address.');
    }

    const turnstileOk = await verifyTurnstile(body.turnstileToken, req.ip);
    if (!turnstileOk) {
      res.status(400).json({
        success: false,
        error: { code: 'CAPTCHA_FAILED', message: 'Please complete the security check.' },
      });
      return;
    }

    // Re-validate the cart right before committing.
    const committed = await commitCart(cart);
    if (!committed.items.length) throw badRequest('Your cart is empty.');

    const { order } = await createOrder({
      cart,
      customer: body.customer,
      userId: req.user?.id,
      passengers: body.passengers,
      pickupOption: body.pickupOption,
      departureOption: body.departureOption,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
      attribution: body.attribution,
      fraudSignal: {
        ip: req.ip ?? '',
        email: body.customer.email,
        phone: body.customer.phone,
        fingerprint: body.fingerprint,
        userAgent: req.headers['user-agent'],
        headers: req.headers as Record<string, string | string[] | undefined>,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        orderId: String(order._id),
        status: order.status,
        total: order.total,
        currency: order.currency,
        items: order.items.map((i) => ({
          productTitle: i.productTitle,
          optionName: i.optionName,
          date: i.date,
          time: i.time,
          travelerCount: i.travelerCount,
          total: i.total,
        })),
      },
    });
  }),
);

export { applySlotDecrement };
