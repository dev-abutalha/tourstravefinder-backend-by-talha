import { Setting } from '../models/System.js';
import { cacheDelete, cacheInvalidateTags, cacheRemember, cacheSet, cacheStats } from './cache.service.js';

/**
 * Key/value settings store replacing the theme's `ttf_*` options.
 */

export interface FraudSettings {
  enabled: boolean;
  reviewThreshold: number;
  blockThreshold: number;
  velocityWindowMinutes: number;
  maxIpAttempts: number;
  maxFingerprintAttempts: number;
  maxEmailAttempts: number;
  duplicateWindowMinutes: number;
  duplicateProductLimit: number;
  blockedIps: string[];
  blockedEmails: string[];
  blockedFingerprints: string[];
  blockedDomains: string[];
  disposableDomains: string[];
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  turnstileMode: 'off' | 'managed' | 'invisible';
  fpjsPublicApiKey: string;
  fpjsRegion: string;
}

export interface PromoSettings {
  showBanner: boolean;
  title: string;
  offerText: string;
  buttonText: string;
  buttonLink: string;
  bgImage: string;
  productType: 'category' | 'tag' | 'products';
  category: string[];
  tag: string[];
  productIds: string[];
}

export interface SiteSettings {
  siteName: string;
  siteUrl: string;
  supportEmail: string;
  adminEmail: string;
  currency: string;
  currencySymbol: string;
  mailFromName: string;
  mailFromAddress: string;
  phoneCountries: string;
  socials: { label: string; url: string; icon: string }[];
  analytics: { gaId?: string; gtmId?: string; facebookPixel?: string; metaPixel?: string };
  seo: { title: string; description: string; ogImage: string };
  booking: { reservationMinutes: number; freeCancellationHours: number };
  blockedEmailDomains: string[];
}

export const DEFAULT_FRAUD_SETTINGS: FraudSettings = {
  enabled: true,
  reviewThreshold: 45,
  blockThreshold: 80,
  velocityWindowMinutes: 30,
  maxIpAttempts: 4,
  maxFingerprintAttempts: 3,
  maxEmailAttempts: 3,
  duplicateWindowMinutes: 120,
  duplicateProductLimit: 2,
  blockedIps: [],
  blockedEmails: [],
  blockedFingerprints: [],
  blockedDomains: [],
  disposableDomains: [
    'mailinator.com',
    '10minutemail.com',
    'tempmail.com',
    'guerrillamail.com',
    'yopmail.com',
    'sharklasers.com',
  ],
  turnstileSiteKey: '',
  turnstileSecretKey: '',
  turnstileMode: 'off',
  fpjsPublicApiKey: '',
  fpjsRegion: 'us',
};

export const DEFAULT_PROMO_SETTINGS: PromoSettings = {
  showBanner: false,
  title: '',
  offerText: '',
  buttonText: '',
  buttonLink: '',
  bgImage: '',
  productType: 'category',
  category: [],
  tag: [],
  productIds: [],
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteName: 'Tours & Travel',
  siteUrl: 'http://localhost:3000',
  supportEmail: 'support@example.com',
  adminEmail: 'admin@example.com',
  currency: 'EUR',
  currencySymbol: '€',
  mailFromName: 'Tours & Travel',
  mailFromAddress: 'noreply@example.com',
  phoneCountries: '',
  socials: [],
  analytics: {},
  seo: { title: '', description: '', ogImage: '' },
  booking: { reservationMinutes: 30, freeCancellationHours: 24 },
  blockedEmailDomains: [
    'outlook.com',
    'aol.com',
    'outlook.fr',
    'outlook.de',
    'outlook.it',
    'outlook.es',
    'hotmail.com',
    'hotmail.fr',
    'hotmail.de',
    'live.com',
    'msn.com',
  ],
};

export const SETTING_KEYS = {
  site: 'ttf_site_settings',
  promo: 'ttf_promo_options',
  fomo: 'ttf_fomo_options',
  fraud: 'ttf_fraud_settings',
  checkout: 'ttf_checkout_settings',
} as const;

async function readRaw<T>(key: string, fallback: T): Promise<T> {
  const row = await Setting.findOne({ key }).lean();
  if (!row) return fallback;
  return (row.value as T) ?? fallback;
}

async function writeRaw<T>(key: string, value: T, group = 'general'): Promise<void> {
  await Setting.findOneAndUpdate(
    { key },
    { $set: { value, group } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  cacheInvalidateTags('settings');
  cacheDelete('site-settings');
}

export const getSiteSettings = async (): Promise<SiteSettings> =>
  cacheRemember('site-settings', async () => readRaw<SiteSettings>(SETTING_KEYS.site, DEFAULT_SITE_SETTINGS), 3600, [
    'settings',
  ]);

export const saveSiteSettings = (value: SiteSettings) => writeRaw(SETTING_KEYS.site, value, 'general');

export const getPromoSettings = async (): Promise<PromoSettings> =>
  readRaw<PromoSettings>(SETTING_KEYS.promo, DEFAULT_PROMO_SETTINGS);

export const savePromoSettings = (value: PromoSettings) => writeRaw(SETTING_KEYS.promo, value, 'marketing');

export interface FomoEntry {
  person: string;
  country: string;
  productIds: string[];
}

export interface FomoSettings {
  enabled: boolean;
  entries: FomoEntry[];
}

export const getFomoSettings = async (): Promise<FomoSettings> =>
  readRaw<FomoSettings>(SETTING_KEYS.fomo, { enabled: false, entries: [] });

export const saveFomoSettings = (value: FomoSettings) => writeRaw(SETTING_KEYS.fomo, value, 'marketing');

export const getFraudSettings = async (): Promise<FraudSettings> => {
  const stored = await readRaw<Partial<FraudSettings>>(SETTING_KEYS.fraud, {});
  return { ...DEFAULT_FRAUD_SETTINGS, ...stored };
};

export const saveFraudSettings = (value: FraudSettings) => writeRaw(SETTING_KEYS.fraud, value, 'security');

export interface CheckoutSettings {
  extras: { id: string; label: string; price: number }[];
  pickupOptions: string[];
  departureOptions: string[];
  requiresCompanyField: boolean;
  minTravelers: number;
  maxTravelers: number;
}

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  extras: [],
  pickupOptions: [],
  departureOptions: [],
  requiresCompanyField: true,
  minTravelers: 1,
  maxTravelers: 50,
};

export const getCheckoutSettings = async (): Promise<CheckoutSettings> =>
  readRaw<CheckoutSettings>(SETTING_KEYS.checkout, DEFAULT_CHECKOUT_SETTINGS);

export const saveCheckoutSettings = (value: CheckoutSettings) => writeRaw(SETTING_KEYS.checkout, value, 'checkout');

export { cacheStats };
