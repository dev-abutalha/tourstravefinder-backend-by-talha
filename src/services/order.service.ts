import dayjs from 'dayjs';
import { Order, Product, type CartDoc, type OrderDoc, type OrderStatus } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import {
  emailAdminNewOrder,
  emailOrderCancelled,
  emailOrderConfirmed,
  emailOrderFailed,
  emailOrderProcessing,
  emailOrderReceived,
} from './email.service.js';
import { scoreFraud, recordFraudEvent, type FraudSignal } from './fraud.service.js';
import { applySlotDecrement, commitCart } from './cart.service.js';
import { decrementSlots } from './availability.service.js';
import { getCheckoutSettings } from './settings.service.js';

/**
 * Order lifecycle.
 *
 * Ported from `includes/order-processing.php` plus the WooCommerce status
 * handling that the theme relied on.
 */

export interface CreateOrderInput {
  cart: CartDoc;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    country?: string;
    address1?: string;
    city?: string;
    postcode?: string;
    state?: string;
  };
  userId?: string;
  passengers: {
    firstName: string;
    lastName: string;
    passport?: string;
    nationality?: string;
    passportExpiry?: string;
    birthDate?: string;
  }[];
  pickupOption?: string;
  departureOption?: string;
  paymentMethod?: string;
  notes?: string;
  attribution?: {
    sourceType?: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    sessionEntry?: string;
    sessionPages?: number;
    deviceType?: string;
  };
  fraudSignal?: FraudSignal;
}

export interface CreateOrderResult {
  order: OrderDoc;
  fraudLevel: 'allowed' | 'review' | 'blocked';
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const checkoutSettings = await getCheckoutSettings();

  if (!input.cart.items.length) throw badRequest('Your cart is empty.');
  if (!input.customer.firstName || !input.customer.lastName) {
    throw badRequest('Please provide a first and last name.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.customer.email)) {
    throw badRequest('Please provide a valid email address.');
  }
  if (!input.customer.phone) throw badRequest('Please provide a phone number.');

  const committed = await commitCart(input.cart);

  // Passenger validation - how many cards we need depends on the product rule.
  const firstProduct = committed.items[0]?.product;
  const passportMode = firstProduct?.passportRequirement ?? 'none';
  const travelerCount = committed.items.reduce((sum, item) => sum + item.travelerCount, 0);

  const expectedPassengers = passportMode === 'all' ? travelerCount : passportMode === 'single' ? 1 : 0;
  if (input.passengers.length < expectedPassengers) {
    throw badRequest(
      passportMode === 'all'
        ? `Please provide passport details for all ${travelerCount} traveller(s).`
        : 'Please provide passport details for the lead traveller.',
    );
  }

  /* Fraud shield ------------------------------------------------ */
  const productKeys = committed.items.map((item) =>
    [String(item.product._id), item.optionIndex, item.date, item.time].join(':'),
  );

  const fraud = input.fraudSignal
    ? await scoreFraud({ ...input.fraudSignal, productKeys })
    : { level: 'allowed' as const, score: 0, reasons: [], signals: {
        ipHash: '', emailHash: '', phoneHash: '', fingerprintHash: '',
        fingerprintSource: '', productKeys,
      }, context: {} };

  if (fraud.level === 'blocked') {
    await recordFraudEvent({
      eventType: 'checkout.blocked',
      userId: input.userId,
      status: 'blocked',
      riskScore: fraud.score,
      ipHash: fraud.signals.ipHash,
      emailHash: fraud.signals.emailHash,
      phoneHash: fraud.signals.phoneHash,
      fingerprintHash: fraud.signals.fingerprintHash,
      productKeys,
      reasons: fraud.reasons,
    });
    throw forbidden('This booking could not be completed. Please contact our support team.');
  }

  /* Create the order ------------------------------------------ */
  const passengers = input.passengers.map((p, index) => ({ ...p, isLead: index === 0 }));

  const order = await Order.create({
    orderNumber: 'TTF-PENDING',
    status: fraud.level === 'review' ? 'fraud-review' : 'pending',
    paymentStatus: 'pending',
    paymentMethod: input.paymentMethod ?? 'cod',
    currency: env.CURRENCY,
    subtotal: committed.subtotal,
    discountTotal: committed.discountTotal,
    feeTotal: committed.feeTotal,
    taxTotal: committed.taxTotal,
    total: committed.total,
    userId: input.userId ?? null,
    customerEmail: input.customer.email.toLowerCase(),
    customerPhone: input.customer.phone,
    billing: {
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      email: input.customer.email.toLowerCase(),
      phone: input.customer.phone,
      country: input.customer.country ?? '',
      address1: input.customer.address1 ?? '',
      city: input.customer.city ?? '',
      state: input.customer.state ?? '',
      postcode: input.customer.postcode ?? '',
    },
    items: committed.items.map((item) => ({
      productId: item.product._id,
      productSlug: item.product.slug,
      productTitle: item.product.title,
      productImage: item.product.images?.[0]?.url ?? '',
      optionIndex: item.optionIndex,
      optionName: item.optionName,
      details: item.details,
      duration: item.duration,
      date: item.date,
      time: item.time,
      language: item.language,
      travelers: item.travelers,
      travelerCount: item.travelerCount,
      unitPrice: item.unitPrice,
      dynamicPrice: item.total,
      total: item.total,
      priceBreakdown: item.breakdown as unknown as Record<string, unknown>,
    })),
    travelerCount,
    passengers,
    extras: input.cart.extras ?? [],
    pickupOption: input.pickupOption ?? '',
    departureOption: input.departureOption ?? '',
    notes: input.notes ?? '',
    couponCode: input.cart.couponCode ?? '',
    fraud: {
      level: fraud.level,
      score: fraud.score,
      reasons: fraud.reasons,
      ip: input.fraudSignal?.ip ?? '',
      ipHash: fraud.signals.ipHash,
      emailHash: fraud.signals.emailHash,
      phoneHash: fraud.signals.phoneHash,
      fingerprint: input.fraudSignal?.fingerprint ?? '',
      fingerprintHash: fraud.signals.fingerprintHash,
      fingerprintSource: fraud.signals.fingerprintSource,
      productKeys,
      context: fraud.context,
    },
    attribution: input.attribution ?? {},
    reviewEnabled: true,
  });

  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  order.orderNumber = `TTF-${String(order._id).slice(-6).toUpperCase()}-${rand}`;
  await order.save();

  /* Slot inventory -------------------------------------------- */
  await applySlotDecrement(committed.items);

  /* Consume the cart ------------------------------------------ */
  input.cart.items.splice(0, input.cart.items.length);
  input.cart.couponCode = '';
  await input.cart.save();

  /* Emails ---------------------------------------------------- */
  const emailPayload = {
    orderNumber: order.orderNumber,
    customerName: input.customer.firstName,
    customerEmail: order.customerEmail,
    currency: order.currency,
    total: order.total,
    trackingUrl: `${env.SITE_URL}/order-status?order=${order.orderNumber}`,
    items: order.items.map((item) => ({
      title: item.productTitle,
      optionName: item.optionName,
      date: item.date,
      time: item.time,
      travelers: item.travelerCount,
      total: item.total,
    })),
  };

  await emailOrderReceived(emailPayload);
  await emailAdminNewOrder(emailPayload);

  await recordFraudEvent({
    eventType: 'checkout.created',
    orderId: String(order._id),
    userId: input.userId,
    status: fraud.level,
    riskScore: fraud.score,
    ipHash: fraud.signals.ipHash,
    emailHash: fraud.signals.emailHash,
    phoneHash: fraud.signals.phoneHash,
    fingerprintHash: fraud.signals.fingerprintHash,
    productKeys,
    reasons: fraud.reasons,
  });

  logger.info({ orderNumber: order.orderNumber, total: order.total }, 'Order created');

  return { order, fraudLevel: fraud.level };
}

/* ------------------------------------------------------------------ */
/* Status transitions                                                 */
/* ------------------------------------------------------------------ */

const STATUS_EMAILS: Partial<Record<OrderStatus, 'received' | 'processing' | 'confirmed' | 'cancelled' | 'failed'>> = {
  processing: 'processing',
  'booking-confirm': 'confirmed',
  completed: 'confirmed',
  cancelled: 'cancelled',
  failed: 'failed',
};

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  options: { note?: string; actor?: string; sendEmail?: boolean } = {},
): Promise<OrderDoc> {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('Order not found.');

  const previous = order.status;
  order.status = status;

  if (status === 'completed' || status === 'processing') {
    order.paymentStatus = 'paid';
  }
  if (status === 'cancelled' || status === 'refunded') {
    order.paymentStatus = status === 'refunded' ? 'refunded' : 'cancelled';
  }
  if (options.note) {
    order.adminNotes = [order.adminNotes, options.note].filter(Boolean).join('\n');
  }

  await order.save();

  // Slot inventory is decremented once, on the first paid transition.
  if ((status === 'processing' || status === 'completed') && !order.slotsReduced) {
    await restoreOrDecrementSlots(order);
    order.slotsReduced = true;
    await order.save();
  }

  const emailKind = STATUS_EMAILS[status];
  if (emailKind && options.sendEmail !== false) {
    const payload = {
      orderNumber: order.orderNumber,
      customerName: order.billing?.firstName ?? 'there',
      customerEmail: order.customerEmail,
      currency: order.currency,
      total: order.total,
      trackingUrl: `${env.SITE_URL}/order-status?order=${order.orderNumber}`,
      items: order.items.map((item) => ({
        title: item.productTitle,
        optionName: item.optionName,
        date: item.date,
        time: item.time,
        travelers: item.travelerCount,
        total: item.total,
      })),
    };
    if (emailKind === 'processing') await emailOrderProcessing(payload);
    else if (emailKind === 'confirmed') await emailOrderConfirmed(payload);
    else if (emailKind === 'cancelled') await emailOrderCancelled(payload);
    else if (emailKind === 'failed') await emailOrderFailed(payload);
  }

  logger.info({ orderNumber: order.orderNumber, previous, status }, 'Order status updated');
  return order;
}

async function restoreOrDecrementSlots(order: OrderDoc) {
  for (const item of order.items) {
    const product = await Product.findById(item.productId);
    if (!product) continue;
    decrementSlots(product, item.optionIndex, item.date, item.time, item.travelerCount);
    await product.save();
  }
}

/* ------------------------------------------------------------------ */
/* Cancellation                                                       */
/* ------------------------------------------------------------------ */

/** Can this order be cancelled free of charge? Port of `ttf_order_is_free_cancellable`. */
export async function getCancellationEligibility(
  order: OrderDoc,
): Promise<{ allowed: boolean; reason: string; travelDate: string | null }> {
  const now = dayjs();
  const hours = env.FREE_CANCELLATION_HOURS;

  for (const item of order.items) {
    const product = await Product.findById(item.productId);
    const policy = product?.keyPoints?.cancellationPolicy ?? '';
    if (!policy || !/free/i.test(policy)) {
      return { allowed: false, reason: 'This booking does not include free cancellation.', travelDate: null };
    }
    if (!item.date) {
      return { allowed: false, reason: 'Travel date not found.', travelDate: null };
    }
    const travelDate = dayjs(item.date);
    if (travelDate.diff(now, 'hour') < hours) {
      return {
        allowed: false,
        reason: `Free cancellation is only available up to ${hours} hours before travel.`,
        travelDate: travelDate.format('MMM DD, YYYY'),
      };
    }
  }

  return { allowed: true, reason: '', travelDate: order.items?.[0]?.date ?? null };
}

export async function requestCancellation(orderId: string, userId: string | undefined, reason: string) {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('Order not found.');
  if (order.userId && String(order.userId) !== userId) throw forbidden('This order belongs to another account.');
  if (order.cancelRequested) throw badRequest('A cancellation request is already pending for this order.');

  const eligibility = await getCancellationEligibility(order);
  if (!eligibility.allowed) throw badRequest(eligibility.reason);

  order.cancelRequested = true;
  order.cancelRequestedAt = new Date();
  order.cancelReason = reason ?? '';
  await order.save();

  const { emailCancellationRequested } = await import('./email.service.js');
  await emailCancellationRequested(
    order.orderNumber,
    order.billing?.firstName ?? 'Customer',
    order.cancelReason,
  );

  return order;
}

export async function resolveCancellation(
  orderId: string,
  decision: 'accept' | 'reject',
  actor: string,
  reason?: string,
) {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('Order not found.');
  if (!order.cancelRequested) throw badRequest('There is no pending cancellation request for this order.');

  order.cancelResolvedAt = new Date();
  order.cancelResolvedBy = actor;

  const { emailCancellationAccepted, emailCancellationRejected } = await import('./email.service.js');
  const customerName = order.billing?.firstName ?? 'Customer';

  if (decision === 'accept') {
    order.cancelRequested = false;
    await order.save();
    await updateOrderStatus(orderId, 'cancelled', { actor, note: 'Cancellation accepted' });
    await emailCancellationAccepted(order.orderNumber, customerName, order.customerEmail);
  } else {
    order.cancelRequested = false;
    await order.save();
    await emailCancellationRejected(order.orderNumber, customerName, order.customerEmail, reason ?? '');
  }

  return order;
}
