import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import {
  DEFAULT_FRAUD_SETTINGS,
  DEFAULT_PROMO_SETTINGS,
  DEFAULT_SITE_SETTINGS,
  getCheckoutSettings,
  getFomoSettings,
  getPromoSettings,
  getSiteSettings,
  saveCheckoutSettings,
  saveFomoSettings,
  savePromoSettings,
  saveSiteSettings,
} from '../../services/settings.service.js';
import { cacheFlush, cacheStats } from '../../services/cache.service.js';

export const adminSettingsRouter = Router();

/* ------------------------------------------------------------------ */
/* Site settings                                                      */
/* ------------------------------------------------------------------ */

adminSettingsRouter.get(
  '/site',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await getSiteSettings() });
  }),
);

adminSettingsRouter.put(
  '/site',
  validate(
    z.object({
      siteName: z.string().min(1),
      siteUrl: z.string().url(),
      supportEmail: z.string().email(),
      adminEmail: z.string().email(),
      currency: z.string().min(3).max(4),
      currencySymbol: z.string().min(1).max(4),
      mailFromName: z.string().min(1),
      mailFromAddress: z.string().email(),
      phoneCountries: z.string().optional(),
      socials: z.array(z.object({ label: z.string(), url: z.string(), icon: z.string().optional() })).optional(),
      analytics: z
        .object({
          gaId: z.string().optional(),
          gtmId: z.string().optional(),
          facebookPixel: z.string().optional(),
          metaPixel: z.string().optional(),
        })
        .optional(),
      seo: z.object({ title: z.string(), description: z.string(), ogImage: z.string() }).optional(),
      booking: z
        .object({ reservationMinutes: z.coerce.number(), freeCancellationHours: z.coerce.number() })
        .optional(),
      blockedEmailDomains: z.array(z.string()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    await saveSiteSettings({ ...DEFAULT_SITE_SETTINGS, ...(req.body as object) });
    res.json({ success: true, data: await getSiteSettings() });
  }),
);

/* ------------------------------------------------------------------ */
/* Promotional banner                                                 */
/* ------------------------------------------------------------------ */

adminSettingsRouter.get(
  '/promo',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await getPromoSettings() });
  }),
);

adminSettingsRouter.put(
  '/promo',
  validate(
    z.object({
      showBanner: z.boolean().optional(),
      title: z.string().optional(),
      offerText: z.string().optional(),
      buttonText: z.string().optional(),
      buttonLink: z.string().optional(),
      bgImage: z.string().optional(),
      productType: z.enum(['category', 'tag', 'products']).optional(),
      category: z.array(z.string()).optional(),
      tag: z.array(z.string()).optional(),
      productIds: z.array(z.string()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    await savePromoSettings({ ...DEFAULT_PROMO_SETTINGS, ...(req.body as object) });
    res.json({ success: true, data: await getPromoSettings() });
  }),
);

/* ------------------------------------------------------------------ */
/* FOMO                                                               */
/* ------------------------------------------------------------------ */

adminSettingsRouter.get(
  '/fomo',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await getFomoSettings() });
  }),
);

adminSettingsRouter.put(
  '/fomo',
  validate(
    z.object({
      enabled: z.boolean(),
      entries: z
        .array(
          z.object({
            person: z.string().min(1),
            country: z.string().default(''),
            productIds: z.array(z.string()).default([]),
          }),
        )
        .default([]),
    }),
  ),
  asyncHandler(async (req, res) => {
    await saveFomoSettings(req.body as { enabled: boolean; entries: { person: string; country: string; productIds: string[] }[] });
    res.json({ success: true, data: await getFomoSettings() });
  }),
);

/* ------------------------------------------------------------------ */
/* Checkout configuration                                             */
/* ------------------------------------------------------------------ */

adminSettingsRouter.get(
  '/checkout',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await getCheckoutSettings() });
  }),
);

adminSettingsRouter.put(
  '/checkout',
  validate(
    z.object({
      extras: z.array(z.object({ id: z.string(), label: z.string(), price: z.coerce.number() })).default([]),
      pickupOptions: z.array(z.string()).default([]),
      departureOptions: z.array(z.string()).default([]),
      requiresCompanyField: z.boolean().default(true),
      minTravelers: z.coerce.number().min(1).default(1),
      maxTravelers: z.coerce.number().min(1).default(50),
    }),
  ),
  asyncHandler(async (req, res) => {
    await saveCheckoutSettings(req.body as never);
    res.json({ success: true, data: await getCheckoutSettings() });
  }),
);

/* ------------------------------------------------------------------ */
/* Maintenance                                                        */
/* ------------------------------------------------------------------ */

adminSettingsRouter.post(
  '/cache/flush',
  asyncHandler(async (_req, res) => {
    cacheFlush();
    res.json({ success: true, data: cacheStats() });
  }),
);

adminSettingsRouter.get(
  '/cache',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: cacheStats() });
  }),
);
