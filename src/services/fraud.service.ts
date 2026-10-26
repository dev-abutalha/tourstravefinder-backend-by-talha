import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { FraudEvent, Order, type OrderDoc } from '../models/index.js';
import { getFraudSettings, type FraudSettings } from './settings.service.js';

/**
 * Fraud Shield - port of `admin-dashboard/fraud-shield.php`.
 *
 * Twelve weighted rules produce a risk score which maps to one of three
 * levels: allowed / review / blocked.
 */

export type FraudLevel = 'allowed' | 'review' | 'blocked';

export interface FraudSignal {
  ip: string;
  email: string;
  phone?: string;
  fingerprint?: string;
  userAgent?: string;
  headers?: Record<string, string | string[] | undefined>;
  productKeys?: string[];
  userId?: string;
}

export interface FraudScore {
  level: FraudLevel;
  score: number;
  reasons: string[];
  signals: {
    ipHash: string;
    emailHash: string;
    phoneHash: string;
    fingerprintHash: string;
    fingerprintSource: string;
    productKeys: string[];
  };
  context: Record<string, unknown>;
}

export function hashValue(value?: string | null): string {
  if (!value) return '';
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function emailDomain(email: string): string {
  const parts = String(email ?? '').toLowerCase().split('@');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function splitList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  return String(value)
    .split(/[\n,]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function isProxyDetected(headers: Record<string, string | string[] | undefined> = {}): boolean {
  const proxyHeaders = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'x-proxy-id', 'true-client-ip'];
  return proxyHeaders.some((h) => {
    const value = headers[h];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

/**
 * Score a booking attempt against the configured rules.
 * Hard blocks (blocklists) short-circuit to `blocked`.
 */
export async function scoreFraud(signal: FraudSignal): Promise<FraudScore> {
  const settings = await getFraudSettings();
  return scoreFraudWithSettings(signal, settings);
}

export async function scoreFraudWithSettings(signal: FraudSignal, settings: FraudSettings): Promise<FraudScore> {
  const reasons: string[] = [];
  let score = 0;
  const context: Record<string, unknown> = {};

  const ip = String(signal.ip ?? '').trim();
  const email = String(signal.email ?? '').trim().toLowerCase();
  const phone = String(signal.phone ?? '').trim();
  const fingerprint = String(signal.fingerprint ?? '').trim();
  const domain = emailDomain(email);

  const ipHash = hashValue(ip);
  const emailHash = hashValue(email);
  const phoneHash = hashValue(phone);
  const fingerprintHash = hashValue(fingerprint);

  const hardBlock = (reason: string): FraudScore => ({
    level: 'blocked',
    score: 100,
    reasons: [reason],
    signals: { ipHash, emailHash, phoneHash, fingerprintHash, fingerprintSource: 'client', productKeys: signal.productKeys ?? [] },
    context,
  });

  // --- Hard blocks -------------------------------------------------------
  if (settings.blockedIps.includes(ip.toLowerCase()) && ip) return hardBlock('IP is on the block list.');
  if (settings.blockedEmails.includes(email) && email) return hardBlock('Email is on the block list.');
  if (settings.blockedDomains.includes(domain) && domain) return hardBlock('Email domain is blocked.');
  if (fingerprint && settings.blockedFingerprints.includes(fingerprint.toLowerCase())) {
    return hardBlock('Device fingerprint is blocked.');
  }

  // --- Soft signals -------------------------------------------------------
  if (domain && settings.disposableDomains.includes(domain)) {
    score += 35;
    reasons.push('Disposable or temporary email domain detected.');
  }

  const windowStart = dayjs().subtract(settings.velocityWindowMinutes, 'minute').toDate();
  const baseFilter: Record<string, unknown> = { createdAt: { $gte: windowStart } };

  const ipAttempts = ip
    ? await Order.countDocuments({ ...baseFilter, 'fraud.ipHash': ipHash })
    : 0;
  if (ipAttempts >= settings.maxIpAttempts) {
    score += 35;
    reasons.push('Too many recent attempts from the same IP.');
  }
  context.ipAttempts = ipAttempts;

  const fpAttempts = fingerprint
    ? await Order.countDocuments({ ...baseFilter, 'fraud.fingerprintHash': fingerprintHash })
    : 0;
  if (fpAttempts >= settings.maxFingerprintAttempts) {
    score += 40;
    reasons.push('Same device fingerprint is creating bookings too quickly.');
  }
  context.fingerprintAttempts = fpAttempts;

  const emailAttempts = email
    ? await Order.countDocuments({ ...baseFilter, 'fraud.emailHash': emailHash })
    : 0;
  if (emailAttempts >= settings.maxEmailAttempts) {
    score += 20;
    reasons.push('Same email has repeated booking attempts in a short time.');
  }
  context.emailAttempts = emailAttempts;

  // Duplicate product/date/time booked by different identities.
  if (signal.productKeys?.length) {
    const duplicateWindow = dayjs().subtract(settings.duplicateWindowMinutes, 'minute').toDate();
    const duplicates = await Order.countDocuments({
      createdAt: { $gte: duplicateWindow },
      'fraud.productKeys': { $in: signal.productKeys },
      'fraud.emailHash': { $ne: emailHash },
    });
    if (duplicates >= settings.duplicateProductLimit) {
      score += 35;
      reasons.push('Same product/date/time was booked multiple times by different identities.');
    }
    context.duplicateBookings = duplicates;
  }

  // Prior risky orders from the same IP / device.
  const riskyPrior = await Order.countDocuments({
    createdAt: { $gte: windowStart },
    status: { $in: ['failed', 'fraud-review', 'cancelled'] },
    $or: [{ 'fraud.ipHash': ipHash }, { 'fraud.fingerprintHash': fingerprintHash }],
  });
  if (riskyPrior > 0) {
    score += Math.min(30, riskyPrior * 10);
    reasons.push('This IP or device matches previous failed or reviewed orders.');
  }
  context.priorRiskyOrders = riskyPrior;

  if (!fingerprint) {
    score += 10;
    reasons.push('No device fingerprint was captured.');
  }

  if (isProxyDetected(signal.headers)) {
    score += 10;
    reasons.push('Proxy or CDN forwarding headers detected.');
  }

  let level: FraudLevel = 'allowed';
  if (!settings.enabled) {
    level = 'allowed';
    reasons.length = 0;
    score = 0;
  } else if (score >= settings.blockThreshold) {
    level = 'blocked';
  } else if (score >= settings.reviewThreshold) {
    level = 'review';
  }

  return {
    level,
    score,
    reasons,
    signals: {
      ipHash,
      emailHash,
      phoneHash,
      fingerprintHash,
      fingerprintSource: fingerprint ? 'client' : '',
      productKeys: signal.productKeys ?? [],
    },
    context,
  };
}

/** Persist a scoring event for the admin audit trail. */
export async function recordFraudEvent(event: {
  eventType: string;
  orderId?: string;
  userId?: string;
  status: FraudLevel;
  riskScore: number;
  ipHash?: string;
  emailHash?: string;
  phoneHash?: string;
  fingerprintHash?: string;
  productKeys?: string[];
  reasons?: string[];
  context?: Record<string, unknown>;
}) {
  try {
    await FraudEvent.create({
      eventType: event.eventType,
      orderId: event.orderId,
      userId: event.userId,
      status: event.status,
      riskScore: event.riskScore,
      ipHash: event.ipHash ?? '',
      emailHash: event.emailHash ?? '',
      phoneHash: event.phoneHash ?? '',
      fingerprintHash: event.fingerprintHash ?? '',
      productKeys: event.productKeys ?? [],
      reasons: event.reasons ?? [],
      context: event.context ?? {},
    });
  } catch {
    /* audit logging must never break checkout */
  }
}

/** Verify a Cloudflare Turnstile token. Returns true when the check passes. */
export async function verifyTurnstile(token: string | undefined, remoteIp?: string): Promise<boolean> {
  const settings = await getFraudSettings();
  if (settings.turnstileMode === 'off' || !settings.turnstileSecretKey) return true;
  if (!token) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const body = new URLSearchParams({ secret: settings.turnstileSecretKey, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const json = (await res.json()) as { success?: boolean };
    return Boolean(json.success);
  } catch {
    return false;
  }
}

/** Recompute the fraud score for existing orders (admin "rescan" action). */
export async function rescanOrders(options: { onlyRisky?: boolean; limit?: number } = {}): Promise<{
  scanned: number;
  changed: number;
}> {
  const settings = await getFraudSettings();
  const filter: Record<string, unknown> = {};
  if (options.onlyRisky) filter['fraud.level'] = { $in: ['review', 'blocked'] };

  const orders = await Order.find(filter).limit(options.limit ?? 500);
  let changed = 0;

  for (const order of orders as OrderDoc[]) {
    const score = await scoreFraudWithSettings(
      {
        ip: order.fraud?.ip ?? '',
        email: order.customerEmail,
        phone: order.customerPhone,
        fingerprint: order.fraud?.fingerprint ?? '',
        productKeys: order.fraud?.productKeys ?? [],
      },
      settings,
    );
    const before = order.fraud?.level;
    order.fraud = {
      ...order.fraud,
      level: score.level,
      score: score.score,
      reasons: score.reasons,
      ipHash: score.signals.ipHash,
      emailHash: score.signals.emailHash,
      phoneHash: score.signals.phoneHash,
      fingerprintHash: score.signals.fingerprintHash,
    } as typeof order.fraud;
    await order.save();
    if (before !== score.level) changed += 1;
  }

  return { scanned: orders.length, changed };
}
