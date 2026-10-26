import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env.js';

const base = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
};

/** Broad limiter applied to the whole API surface. */
export const apiLimiter: RateLimitRequestHandler = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 600,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});

/** Login / registration / OTP / review submission - tight limits. */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

/** Checkout / order creation. */
export const checkoutLimiter: RateLimitRequestHandler = rateLimit({
  ...base,
  windowMs: 10 * 60_000,
  limit: 30,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many checkout attempts.' } },
});

/** Generic write limiter used on admin mutations. */
export const writeLimiter: RateLimitRequestHandler = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 600,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many write operations.' } },
});
