import dayjs from 'dayjs';
import type { ProductDoc } from '../../models/Product.js';
import { normaliseTime } from './pricing.service.js';

/**
 * Slot availability.
 *
 * Ported from the theme's `_ttf_unavailable_slots` / `_ttf_slot_quantities`
 * product meta. Both are nested maps:
 *   unavailable : optionIndex -> YYYY-MM-DD -> [HH:MM]
 *   quantities  : optionIndex -> YYYY-MM-DD -> HH:MM -> remaining (0 = unlimited)
 *
 * They are stored as Mongoose Maps whose values are plain objects, so they are
 * normalised to plain JS objects on read and written back as plain objects.
 */

type Nested = Record<string, unknown>;

export function readNestedMap(source: unknown): Nested {
  if (!source) return {};
  if (source instanceof Map) {
    const out: Nested = {};
    for (const [key, value] of source.entries()) {
      out[String(key)] = value instanceof Map ? Object.fromEntries(value.entries()) : (value as Nested);
    }
    return out;
  }
  if (typeof source === 'object') return source as Nested;
  return {};
}

export function unavailableFor(product: ProductDoc, optionIndex: number): Record<string, string[]> {
  const all = readNestedMap(product.unavailableSlots);
  const entry = all[String(optionIndex)] as Record<string, string[]> | undefined;
  if (!entry) return {};
  return Object.fromEntries(Object.entries(entry).map(([date, times]) => [date, (times ?? []).map(normaliseTime)]));
}

export function quantitiesFor(product: ProductDoc, optionIndex: number): Record<string, Record<string, number>> {
  const all = readNestedMap(product.slotQuantities);
  const entry = all[String(optionIndex)] as Record<string, Record<string, number>> | undefined;
  if (!entry) return {};
  return Object.fromEntries(
    Object.entries(entry).map(([date, times]) => [
      date,
      Object.fromEntries(Object.entries(times ?? {}).map(([time, qty]) => [normaliseTime(time), Number(qty) || 0])),
    ]),
  );
}

/** Is this specific date+time blocked for the option? */
export function isSlotUnavailable(product: ProductDoc, optionIndex: number, date: string, time: string): boolean {
  const unavailable = unavailableFor(product, optionIndex);
  const times = unavailable[date];
  if (!times?.length) return false;
  return times.includes(normaliseTime(time));
}

/** Remaining capacity for a slot. `0` means unlimited (never decremented). */
export function remainingQuantity(product: ProductDoc, optionIndex: number, date: string, time: string): number {
  const quantities = quantitiesFor(product, optionIndex);
  const qty = quantities[date]?.[normaliseTime(time)];
  return qty === undefined ? 0 : qty;
}

export interface DayAvailability {
  date: string;
  available: boolean;
  reason?: string;
  times: { time: string; available: boolean; remaining: number }[];
}

/**
 * Availability for a single option on a given date, including the start times
 * configured on the option and their remaining capacity.
 */
export function dayAvailability(product: ProductDoc, optionIndex: number, date: string): DayAvailability {
  const option = product.productOptions?.[optionIndex];
  if (!option) return { date, available: false, reason: 'Option not found', times: [] };

  const travelDate = dayjs(date);
  const today = dayjs().startOf('day');

  if (travelDate.isBefore(today, 'day')) {
    return { date, available: false, reason: 'Date is in the past', times: [] };
  }
  if (option.startDate && travelDate.isBefore(dayjs(option.startDate), 'day')) {
    return { date, available: false, reason: `Available from ${option.startDate}`, times: [] };
  }
  if (option.endDate && travelDate.isAfter(dayjs(option.endDate), 'day')) {
    return { date, available: false, reason: `Available until ${option.endDate}`, times: [] };
  }
  const repeat = (option.repeat ?? []).map((d) => d.trim().toLowerCase());
  if (repeat.length && !repeat.includes(travelDate.format('ddd').toLowerCase())) {
    return { date, available: false, reason: 'Not available on this weekday', times: [] };
  }

  const unavailable = unavailableFor(product, optionIndex)[date] ?? [];
  const quantities = quantitiesFor(product, optionIndex)[date] ?? {};
  const times = (option.startTime ?? []).map(normaliseTime);

  const timeSlots = times.map((time) => {
    const remaining = quantities[time] ?? 0;
    const blocked = unavailable.includes(time);
    const soldOut = remaining > 0 && remaining <= 0;
    return { time, available: !blocked && !soldOut, remaining };
  });

  return {
    date,
    available: timeSlots.length === 0 ? true : timeSlots.some((t) => t.available),
    times: timeSlots,
  };
}

/**
 * Availability calendar for a product across a date window.
 * `windowDays` limits how far ahead we expose inventory.
 */
export function availabilityCalendar(
  product: ProductDoc,
  optionIndex: number,
  from: string,
  to: string,
): DayAvailability[] {
  const start = dayjs(from).startOf('day');
  const end = dayjs(to).startOf('day');
  const out: DayAvailability[] = [];
  let cursor = start;
  let guard = 0;
  while ((cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) && guard < 400) {
    out.push(dayAvailability(product, optionIndex, cursor.format('YYYY-MM-DD')));
    cursor = cursor.add(1, 'day');
    guard += 1;
  }
  return out;
}

/**
 * Mark a slot as unavailable / available again.
 * Used by the admin availability grid.
 */
export function setSlotAvailability(
  product: ProductDoc,
  optionIndex: number,
  date: string,
  time: string,
  unavailable: boolean,
): void {
  const key = String(optionIndex);
  const all = readNestedMap(product.unavailableSlots);
  const entry = (all[key] ?? {}) as Record<string, string[]>;
  const current = (entry[date] ?? []).map(normaliseTime);
  const normalised = normaliseTime(time);

  const next = unavailable
    ? Array.from(new Set([...current, normalised]))
    : current.filter((t) => t !== normalised);

  if (next.length) entry[date] = next;
  else delete entry[date];

  all[key] = entry;
  product.unavailableSlots.set(key, entry as unknown as Nested);
  product.markModified('unavailableSlots');
}

/**
 * Set (or clear) the capacity for a slot.
 * `0` clears the limit and makes the slot unlimited.
 */
export function setSlotQuantity(
  product: ProductDoc,
  optionIndex: number,
  date: string,
  time: string,
  quantity: number,
): void {
  const key = String(optionIndex);
  const all = readNestedMap(product.slotQuantities);
  const entry = (all[key] ?? {}) as Record<string, Record<string, number>>;
  const dayEntry = entry[date] ?? {};

  if (quantity > 0) dayEntry[normaliseTime(time)] = quantity;
  else delete dayEntry[normaliseTime(time)];

  if (Object.keys(dayEntry).length) entry[date] = dayEntry;
  else delete entry[date];

  all[key] = entry;
  product.slotQuantities.set(key, entry as unknown as Nested);
  product.markModified('slotQuantities');
}

/**
 * Decrement inventory for every booked slot on an order.
 * Returns the list of slots that were changed.
 */
export function decrementSlots(
  product: ProductDoc,
  optionIndex: number,
  date: string,
  time: string,
  participants: number,
): { changed: boolean; remaining: number } {
  const normalised = normaliseTime(time);
  const quantities = quantitiesFor(product, optionIndex);
  const current = quantities[date]?.[normalised];

  // Unlimited slot - nothing to decrement.
  if (current === undefined) return { changed: false, remaining: 0 };

  const remaining = Math.max(0, current - participants);
  setSlotQuantity(product, optionIndex, date, normalised, remaining);
  if (remaining === 0) setSlotAvailability(product, optionIndex, date, normalised, true);

  return { changed: true, remaining };
}
