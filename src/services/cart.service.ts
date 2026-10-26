import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { Cart, Coupon, Product, type CartDoc, type CouponDoc, type ProductDoc } from '../models/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { env } from '../config/env.js';
import { quoteBooking, type PriceQuote, type TravelerCounts } from './pricing.service.js';
import { decrementSlots, isSlotUnavailable } from './availability.service.js';

/**
 * Server-side cart.
 *
 * Replaces the WooCommerce session cart. Items carry a 30 minute reservation
 * window (matching the theme's `ttf_reservation` TTL) and every price is
 * recomputed on read so a stale client price can never leak through.
 */

export const CART_COOKIE = 'ttf_cart';

export interface CartItemView {
  key: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  productImage: string;
  optionIndex: number;
  optionName: string;
  details: string;
  duration: string;
  date: string;
  time: string;
  language: string;
  travelers: TravelerCounts;
  travelerCount: number;
  unitPrice: number;
  dynamicPrice: number;
  total: number;
  priceBreakdown: PriceQuote | null;
  addedAt: string;
  available: boolean;
  unavailableReason?: string;
}

export interface CartView {
  sessionId: string;
  items: CartItemView[];
  extras: { id: string; label: string; price: number }[];
  couponCode: string;
  travelerCount: number;
  subtotal: number;
  discountTotal: number;
  feeTotal: number;
  taxTotal: number;
  total: number;
  expiresAt: string;
  reservationExpiresIn: number;
}

export function newSessionId(): string {
  return crypto.randomBytes(24).toString('hex');
}

export async function getOrCreateCart(sessionId: string, userId?: string): Promise<CartDoc> {
  const existing = await Cart.findOne({ sessionId });
  if (existing) {
    if (existing.expiresAt.getTime() < Date.now()) {
      existing.items.splice(0, existing.items.length);
      existing.couponCode = '';
      existing.expiresAt = cartExpiry();
      await existing.save();
    }
    if (userId && !existing.userId) {
      existing.userId = existing.userId ?? (userId as unknown as CartDoc['userId']);
      await existing.save();
    }
    return existing;
  }

  return Cart.create({
    sessionId,
    userId: userId ?? null,
    items: [],
    expiresAt: cartExpiry(),
  });
}

export function cartExpiry(): Date {
  return dayjs().add(env.BOOKING_RESERVATION_MINUTES, 'minute').toDate();
}

export function itemKey(input: {
  productId: string;
  optionIndex: number;
  date: string;
  time: string;
  language: string;
}): string {
  return crypto
    .createHash('md5')
    .update(
      JSON.stringify({
        productId: String(input.productId),
        optionIndex: input.optionIndex,
        date: input.date,
        time: input.time ?? '',
        language: input.language ?? '',
      }),
    )
    .digest('hex');
}

export interface AddItemInput {
  productId: string;
  optionIndex: number;
  date: string;
  time?: string;
  language?: string;
  travelers: Partial<TravelerCounts>;
}

/**
 * Add a booking to the cart. Re-prices server-side and refuses slots that
 * have just been taken by somebody else.
 */
export async function addItem(cart: CartDoc, input: AddItemInput): Promise<{ cart: CartDoc; quote: PriceQuote }> {
  const product = (await Product.findById(input.productId)) as ProductDoc | null;
  if (!product) throw notFound('Product not found.');
  if (product.status !== 'publish') throw badRequest('This product is not available for booking.');

  const quote = quoteBooking({
    product,
    optionIndex: input.optionIndex,
    date: input.date,
    time: input.time,
    travelers: input.travelers,
  });

  if (isSlotUnavailable(product, input.optionIndex, input.date, input.time ?? '')) {
    throw badRequest('That slot has just been taken. Please pick another time.');
  }

  const key = itemKey({
    productId: input.productId,
    optionIndex: input.optionIndex,
    date: input.date,
    time: input.time ?? '',
    language: input.language ?? '',
  });

  const option = product.productOptions?.[input.optionIndex];
  const existingIndex = cart.items.findIndex((i: { key: string }) => i.key === key);

  const item = {
    key,
    productId: product._id,
    productTitle: product.title,
    productSlug: product.slug,
    optionIndex: input.optionIndex,
    optionName: option?.name ?? '',
    details: option?.details ?? '',
    duration: option?.duration ?? '',
    date: input.date,
    time: input.time ?? '',
    language: input.language ?? '',
    travelers: quote.travelers,
    travelerCount: quote.travelerCount,
    unitPrice: quote.perPerson,
    dynamicPrice: quote.total,
    priceBreakdown: quote as unknown as Record<string, unknown>,
    addedAt: new Date(),
  };

  if (existingIndex >= 0) cart.items.splice(existingIndex, 1, item as never);
  else cart.items.push(item as never);

  cart.expiresAt = cartExpiry();
  await cart.save();
  return { cart, quote };
}

export async function removeItem(cart: CartDoc, key: string): Promise<CartDoc> {
  const kept = cart.items.filter((i: { key: string }) => i.key !== key);
  cart.items.splice(0, cart.items.length, ...kept);
  cart.expiresAt = cartExpiry();
  await cart.save();
  return cart;
}

export async function updateItemTravelers(
  cart: CartDoc,
  key: string,
  travelers: Partial<TravelerCounts>,
): Promise<{ cart: CartDoc; quote: PriceQuote }> {
  const target = cart.items.find((i: { key: string }) => i.key === key);
  if (!target) throw notFound('Cart item not found.');

  const product = (await Product.findById(target.productId)) as ProductDoc | null;
  if (!product) throw notFound('Product no longer exists.');

  const quote = quoteBooking({
    product,
    optionIndex: target.optionIndex,
    date: target.date,
    time: target.time,
    travelers,
  });

  target.travelers = quote.travelers as never;
  target.travelerCount = quote.travelerCount;
  target.unitPrice = quote.perPerson;
  target.dynamicPrice = quote.total;
  target.priceBreakdown = quote as unknown as Record<string, unknown>;

  cart.expiresAt = cartExpiry();
  await cart.save();
  return { cart, quote };
}

export async function setExtras(
  cart: CartDoc,
  extras: { id: string; label: string; price: number }[],
): Promise<CartDoc> {
  cart.extras.splice(0, cart.extras.length, ...(extras as never[]));
  await cart.save();
  return cart;
}

export async function setTravelerCount(cart: CartDoc, count: number): Promise<CartDoc> {
  cart.travelerCount = Math.max(1, Math.min(50, Math.floor(count) || 1));
  await cart.save();
  return cart;
}

export interface CouponResult {
  valid: boolean;
  message: string;
  discount: number;
  coupon?: CouponDoc;
}

/** Validate a coupon against the cart subtotal. */
export async function validateCoupon(code: string, subtotal: number): Promise<CouponResult> {
  if (!code) return { valid: true, message: '', discount: 0 };

  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase(), active: true });
  if (!coupon) return { valid: false, message: 'This coupon code is not valid.', discount: 0 };
  if (coupon.dateExpires && coupon.dateExpires.getTime() < Date.now()) {
    return { valid: false, message: 'This coupon has expired.', discount: 0 };
  }
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, message: 'This coupon has reached its usage limit.', discount: 0 };
  }
  if (coupon.minimumAmount > 0 && subtotal < coupon.minimumAmount) {
    return {
      valid: false,
      message: `This coupon requires a minimum order of ${coupon.minimumAmount}.`,
      discount: 0,
    };
  }
  if (coupon.maximumAmount > 0 && subtotal > coupon.maximumAmount) {
    return {
      valid: false,
      message: `This coupon cannot be used on orders above ${coupon.maximumAmount}.`,
      discount: 0,
    };
  }

  let discount = 0;
  if (coupon.type === 'percent') discount = (subtotal * coupon.amount) / 100;
  else if (coupon.type === 'fixed_product') discount = Math.min(coupon.amount, subtotal);
  else discount = Math.min(coupon.amount, subtotal);

  return { valid: true, message: 'Coupon applied.', discount: Math.round(discount * 100) / 100, coupon };
}

/**
 * Build the read model for a cart, re-pricing every item so the totals are
 * always derived from live product data.
 */
export async function buildCartView(cart: CartDoc): Promise<CartView> {
  const items: CartItemView[] = [];
  let subtotal = 0;
  let taxTotal = 0;

  const productIds = [...new Set(cart.items.map((i: { productId: unknown }) => String(i.productId)))];
  const products = productIds.length ? await Product.find({ _id: { $in: productIds } }) : [];
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  for (const item of cart.items) {
    const product = productMap.get(String(item.productId));
    let view: CartItemView = {
      key: item.key,
      productId: String(item.productId),
      productTitle: item.productTitle ?? '',
      productSlug: item.productSlug ?? '',
      productImage: product?.images?.[0]?.url ?? '',
      optionIndex: item.optionIndex,
      optionName: item.optionName ?? '',
      details: item.details ?? '',
      duration: item.duration,
      date: item.date,
      time: item.time,
      language: item.language,
      travelers: item.travelers as unknown as TravelerCounts,
      travelerCount: item.travelerCount,
      unitPrice: item.unitPrice,
      dynamicPrice: item.dynamicPrice,
      total: item.dynamicPrice,
      priceBreakdown: (item.priceBreakdown as unknown as PriceQuote) ?? null,
      addedAt: new Date(item.addedAt).toISOString(),
      available: true,
    };

    if (product) {
      try {
        const quote = quoteBooking({
          product,
          optionIndex: item.optionIndex,
          date: item.date,
          time: item.time,
          travelers: item.travelers as unknown as TravelerCounts,
        });
        view.priceBreakdown = quote;
        view.unitPrice = quote.perPerson;
        view.total = quote.total;
        view.dynamicPrice = quote.total;
        view.available = !isSlotUnavailable(product, item.optionIndex, item.date, item.time);
        if (!view.available) view.unavailableReason = 'This slot is no longer available.';
      } catch (err) {
        view.available = false;
        view.unavailableReason = err instanceof Error ? err.message : 'No longer bookable';
      }
    } else {
      view.available = false;
      view.unavailableReason = 'Product no longer exists.';
    }

    subtotal += view.total;
    taxTotal += view.priceBreakdown?.taxTotal ?? 0;
    items.push(view);
  }

  const couponResult = await validateCoupon(cart.couponCode, subtotal);
  const discountTotal = couponResult.valid ? couponResult.discount : 0;
  const feeTotal = (cart.extras ?? []).reduce((sum: number, extra: { price?: number | null }) => sum + (Number(extra.price) || 0), 0);

  const total = Math.max(0, subtotal - discountTotal + feeTotal);

  return {
    sessionId: cart.sessionId,
    items,
    extras: (cart.extras ?? []) as unknown as { id: string; label: string; price: number }[],
    couponCode: cart.couponCode ?? '',
    travelerCount: cart.travelerCount ?? 1,
    subtotal: Math.round(subtotal * 100) / 100,
    discountTotal,
    feeTotal: Math.round(feeTotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    total: Math.round(total * 100) / 100,
    expiresAt: cart.expiresAt.toISOString(),
    reservationExpiresIn: Math.max(0, Math.floor((cart.expiresAt.getTime() - Date.now()) / 1000)),
  };
}

/**
 * Commit the cart into an order: re-price, decrement slot inventory and mark
 * the cart as consumed.
 */
export async function commitCart(cart: CartDoc): Promise<{
  items: {
    product: ProductDoc;
    optionIndex: number;
    optionName: string;
    details: string;
    duration: string;
    date: string;
    time: string;
    language: string;
    travelers: TravelerCounts;
    travelerCount: number;
    unitPrice: number;
    total: number;
    breakdown: PriceQuote;
  }[];
  subtotal: number;
  discountTotal: number;
  feeTotal: number;
  taxTotal: number;
  total: number;
}> {
  const items = [] as Awaited<ReturnType<typeof commitCart>>['items'];

  let subtotal = 0;
  let taxTotal = 0;

  for (const item of cart.items) {
    const product = (await Product.findById(item.productId)) as ProductDoc | null;
    if (!product) throw badRequest('A product in your cart no longer exists.');
    if (product.status !== 'publish') throw badRequest(`"${product.title}" is not available for booking.`);

    const quote = quoteBooking({
      product,
      optionIndex: item.optionIndex,
      date: item.date,
      time: item.time,
      travelers: item.travelers as unknown as TravelerCounts,
    });

    if (isSlotUnavailable(product, item.optionIndex, item.date, item.time)) {
      throw badRequest(`"${product.title}" on ${item.date} at ${item.time || ''} is no longer available. Please choose another slot.`);
    }
    // Also validate day/time against current calendar rules
    const da = (await import('./availability.service.js')).dayAvailability(product, item.optionIndex, item.date);
    if (!da.available) throw badRequest(`"${product.title}" on ${item.date} is not available for booking.`);
    if (item.time && !da.times.some((t: { time: string; available: boolean }) => t.time === item.time && t.available)) {
      throw badRequest(`"${product.title}" at ${item.time} on ${item.date} is no longer available.`);
    }

    const option = product.productOptions?.[item.optionIndex];
    items.push({
      product,
      optionIndex: item.optionIndex,
      optionName: option?.name ?? '',
      details: option?.details ?? '',
      duration: option?.duration ?? '',
      date: item.date,
      time: item.time,
      language: item.language,
      travelers: quote.travelers,
      travelerCount: quote.travelerCount,
      unitPrice: quote.perPerson,
      total: quote.total,
      breakdown: quote,
    });

    subtotal += quote.total;
    taxTotal += quote.taxTotal;
  }

  const couponResult = await validateCoupon(cart.couponCode, subtotal);
  const discountTotal = couponResult.valid ? couponResult.discount : 0;
  const feeTotal = (cart.extras ?? []).reduce((sum: number, extra: { price?: number | null }) => sum + (Number(extra.price) || 0), 0);

  return {
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    discountTotal,
    feeTotal: Math.round(feeTotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    total: Math.round(Math.max(0, subtotal - discountTotal + feeTotal) * 100) / 100,
  };
}

/** Decrement slot inventory for every committed item. */
export async function applySlotDecrement(
  items: { product: ProductDoc; optionIndex: number; date: string; time: string; travelerCount: number }[],
): Promise<void> {
  for (const item of items) {
    decrementSlots(item.product, item.optionIndex, item.date, item.time, item.travelerCount);
    await item.product.save();
  }
}
