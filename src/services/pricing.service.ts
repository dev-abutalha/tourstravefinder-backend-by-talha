import dayjs from 'dayjs';
import { TRAVELER_CATEGORIES, type ProductDoc, type TravelerCategory } from '../models/Product.js';
import { badRequest } from '../lib/errors.js';

/**
 * Booking pricing engine.
 *
 * Mirrors the original theme's `ttf_compute_booking_price()` exactly:
 *   unit price = buying_price + service_charge + (service_charge * tax / 100)
 *   last-minute surcharge = subtotal * (lastdays.percent / 100) when the travel
 *   date is within `lastdays.days` days.
 *
 * The client NEVER supplies a price - it is always recomputed here.
 */

export interface TravelerCounts {
  Adult: number;
  Child: number;
  Infant: number;
  Youth: number;
  Senior: number;
}

export interface PriceBreakdownRow {
  category: TravelerCategory;
  count: number;
  buyingPrice: number;
  serviceCharge: number;
  taxPercent: number;
  unitPrice: number;
  subtotal: number;
  taxAmount: number;
}

export interface PriceQuote {
  travelers: TravelerCounts;
  travelerCount: number;
  breakdown: PriceBreakdownRow[];
  subtotal: number;
  serviceChargeTotal: number;
  taxTotal: number;
  surchargePercent: number;
  surcharge: number;
  total: number;
  perPerson: number;
  currency: string;
  lastMinuteApplied: boolean;
  daysUntilTravel: number;
}

export const emptyTravelers = (): TravelerCounts => ({ Adult: 0, Child: 0, Infant: 0, Youth: 0, Senior: 0 });

export function normaliseTravelers(input: Partial<TravelerCounts> | undefined): TravelerCounts {
  const out = emptyTravelers();
  for (const key of TRAVELER_CATEGORIES) {
    const value = Number(input?.[key] ?? 0);
    out[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return out;
}

export function totalTravelers(travelers: TravelerCounts): number {
  return TRAVELER_CATEGORIES.reduce((sum, key) => sum + (travelers[key] || 0), 0);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** `H:MM` -> `HH:MM` so `9:00` and `09:00` compare equal. */
export function normaliseTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time.trim();
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value, 'YYYY-MM-DD', true).isValid();
}

export function computeUnitPrice(price: {
  buyingPrice?: number;
  serviceCharge?: number;
  tax?: number;
}): { unitPrice: number; serviceCharge: number; taxAmount: number } {
  const buying = Number(price.buyingPrice ?? 0);
  const service = Number(price.serviceCharge ?? 0);
  const taxPercent = Number(price.tax ?? 0);
  const taxAmount = (service * taxPercent) / 100;
  return {
    unitPrice: round2(buying + service + taxAmount),
    serviceCharge: round2(service),
    taxAmount: round2(taxAmount),
  };
}

export interface QuoteInput {
  product: ProductDoc;
  optionIndex: number;
  date: string;
  time?: string;
  travelers: Partial<TravelerCounts>;
  /** Reference "now" - injectable for tests and for deterministic server-side pricing. */
  now?: dayjs.Dayjs;
}

/**
 * Validates the booking request and returns a full price quote.
 * Throws `AppError(400)` with a human-readable reason when the slot is invalid.
 */
export function quoteBooking(input: QuoteInput): PriceQuote {
  const { product, optionIndex, date, time } = input;
  const now = input.now ?? dayjs();
  const travelers = normaliseTravelers(input.travelers);

  const options = product.productOptions ?? [];
  const option = options[optionIndex];
  if (!option) {
    throw badRequest('That booking option is no longer available.');
  }
  if (!option.active) {
    throw badRequest('That booking option is currently not bookable.');
  }

  if (!isValidDate(date)) {
    throw badRequest('Please choose a valid travel date.');
  }

  const travelDate = dayjs(date);
  const daysUntilTravel = travelDate.startOf('day').diff(now.startOf('day'), 'day');

  if (option.startDate && travelDate.isBefore(dayjs(option.startDate), 'day')) {
    throw badRequest(`This option is only available from ${option.startDate}.`);
  }
  if (option.endDate && travelDate.isAfter(dayjs(option.endDate), 'day')) {
    throw badRequest(`This option is only available until ${option.endDate}.`);
  }

  const repeat = (option.repeat ?? []).map((d) => d.trim().toLowerCase());
  if (repeat.length) {
    const weekday = travelDate.format('ddd').toLowerCase();
    if (!repeat.includes(weekday)) {
      throw badRequest(`This option does not run on ${travelDate.format('dddd')}s.`);
    }
  }

  const startTimes = (option.startTime ?? []).map(normaliseTime);
  if (startTimes.length) {
    if (!time) throw badRequest('Please choose a start time.');
    if (!startTimes.includes(normaliseTime(time))) {
      throw badRequest('That start time is not available for this option.');
    }
  }

  const count = totalTravelers(travelers);
  if (count < 1) {
    throw badRequest('Please select at least one traveller.');
  }
  if (count > 50) {
    throw badRequest('A maximum of 50 travellers is allowed per booking.');
  }

  const priceRows = option.prices ?? [];
  if (!priceRows.length) {
    throw badRequest('This option has no pricing configured.');
  }

  const breakdown: PriceBreakdownRow[] = [];
  let subtotal = 0;
  let serviceChargeTotal = 0;
  let taxTotal = 0;

  for (const category of TRAVELER_CATEGORIES) {
    const qty = travelers[category] || 0;
    if (!qty) continue;
    const row = priceRows.find((p) => p.category === category);
    if (!row) {
      throw badRequest(`No price is configured for ${category} travellers on this option.`);
    }
    const { unitPrice, serviceCharge, taxAmount } = computeUnitPrice(row);
    const lineSubtotal = round2(unitPrice * qty);
    breakdown.push({
      category,
      count: qty,
      buyingPrice: round2(Number(row.buyingPrice ?? 0)),
      serviceCharge,
      taxPercent: Number(row.tax ?? 0),
      unitPrice,
      subtotal: lineSubtotal,
      taxAmount: round2(taxAmount * qty),
    });
    subtotal += lineSubtotal;
    serviceChargeTotal += round2(serviceCharge * qty);
    taxTotal += round2(taxAmount * qty);
  }

  subtotal = round2(subtotal);
  serviceChargeTotal = round2(serviceChargeTotal);
  taxTotal = round2(taxTotal);

  const lastDays = Number(option.lastDays?.days ?? 0);
  const lastPercent = Number(option.lastDays?.percent ?? 0);
  const lastMinuteApplied = lastDays > 0 && lastPercent > 0 && daysUntilTravel >= 0 && daysUntilTravel <= lastDays;
  const surcharge = lastMinuteApplied ? round2((subtotal * lastPercent) / 100) : 0;

  const total = round2(subtotal + surcharge);

  return {
    travelers,
    travelerCount: count,
    breakdown,
    subtotal,
    serviceChargeTotal,
    taxTotal,
    surchargePercent: lastMinuteApplied ? lastPercent : 0,
    surcharge,
    total,
    perPerson: count ? round2(total / count) : 0,
    currency: product.currency || 'EUR',
    lastMinuteApplied,
    daysUntilTravel,
  };
}
