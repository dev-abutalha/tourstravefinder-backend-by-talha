import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import {
  BlogCategory,
  Category,
  Coupon,
  Faq,
  FaqCategory,
  FraudEvent,
  Order,
  Page,
  Post,
  Product,
  Review,
  Showcase,
  Taxonomy,
  User,
} from '../models/index.js';
import {
  DEFAULT_FRAUD_SETTINGS,
  getSiteSettings,
  saveFomoSettings,
  saveFraudSettings,
  savePromoSettings,
  saveSiteSettings,
  type FraudSettings,
  type PromoSettings,
  type SiteSettings,
} from '../services/settings.service.js';

type Row = Record<string, any>;

interface WpExport {
  meta: { exportedAt: string; counts: Row };
  options: Row;
  terms: Record<string, Row[]>;
  users: Row[];
  attachments: Row[];
  products: Row[];
  posts: Row[];
  pages: Row[];
  showcases: Row[];
  orders: Row[];
  reviews: Row[];
  fraudEvents: Row[];
  coupons: Row[];
}

const FRESH = process.argv.includes('--fresh');
const EXPORT_PATH =
  process.env.WP_MYSQL_JSON ?? path.resolve(process.cwd(), '.data/wp-mysql-export.json');
const CHUNK = 100;

const data = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8')) as WpExport;

const productByWpId = new Map<number, Types.ObjectId>();
const categoryByWpId = new Map<number, Types.ObjectId>();
const blogCategoryByWpId = new Map<number, Types.ObjectId>();
const taxonomyByWpId = new Map<number, Types.ObjectId>();
const userByWpId = new Map<number, Types.ObjectId>();
const orderByWpId = new Map<number, Types.ObjectId>();
const attachmentByWpId = new Map<number, Row>();
const mediaFiles = new Set<string>();
const mediaByBasename = new Map<string, string>();

for (const attachment of data.attachments) {
  attachmentByWpId.set(Number(attachment.id), attachment);
  if (attachment.exists && attachment.file) {
    const file = String(attachment.file);
    mediaFiles.add(file);
    mediaByBasename.set(path.basename(file).toLowerCase(), file);
  }
}

const usedProductSlugs = new Set<string>();

function oid(namespace: string, value: string | number): Types.ObjectId {
  const hash = crypto.createHash('md5').update(`${namespace}:${value}`).digest('hex');
  return new Types.ObjectId(hash.slice(0, 24));
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function dateAt(value: unknown, fallback = new Date()): Date {
  if (!value) return fallback;
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function uniqueProductSlug(value: string, id: number): string {
  const base = slugify(str(value), { lower: true, strict: true }) || `product-${id}`;
  let candidate = base;
  let index = 2;
  while (usedProductSlugs.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  usedProductSlugs.add(candidate);
  return candidate;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function htmlText(value: unknown): string {
  return decodeEntities(
    str(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function listItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => num(item)).filter((item) => item > 0);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
  }
  return [];
}

function rewriteMedia(value: unknown): string {
  const input = str(value);
  if (!input) return '';
  const withLocalMedia = input.replace(
    /((?:https?:)?\/\/[^/\s"'<>]+\/wp-content\/uploads\/)([^\s"'<>)]+)/gi,
    (match, _prefix: string, file: string) => {
      const clean = file.split('?')[0] ?? file;
      const hostMatch = /\/\/([^/\s"'<>]+)\//.exec(match);
      const host = hostMatch?.[1] ?? '';
      const isLocalHost =
        host.includes('tours-travel-finder.local') || host.includes('different-territory.localsite.io');
      const resolved = mediaFiles.has(clean)
        ? clean
        : mediaByBasename.get(path.basename(clean).toLowerCase()) ?? clean;
      if (isLocalHost || mediaFiles.has(clean) || mediaByBasename.has(path.basename(clean).toLowerCase())) {
        return `/media/wp/${resolved}`;
      }
      return match;
    },
  );
  return withLocalMedia
    .replace(/\/wp-content\/uploads\//gi, '/media/wp/')
    .replace(/https?:\/\/(?:www\.)?tours-travel-finder\.local/gi, '')
    .replace(/https?:\/\/(?:www\.)?different-territory\.localsite\.io/gi, '');
}

function imageUrl(id: unknown): string {
  const attachment = attachmentByWpId.get(num(id));
  return attachment ? rewriteMedia(attachment.url) : '';
}

function imageRecord(id: unknown): { url: string; alt: string; width?: number; height?: number } | null {
  const attachment = attachmentByWpId.get(num(id));
  if (!attachment) return null;
  return {
    url: rewriteMedia(attachment.url),
    alt: str(attachment.alt),
    width: num(attachment.width) || undefined,
    height: num(attachment.height) || undefined,
  };
}

function renderElementor(nodes: any[]): string {
  const out: string[] = [];
  for (const node of nodes ?? []) {
    if (node?.elType === 'widget') {
      out.push(renderElementorWidget(node));
    }
    if (Array.isArray(node?.elements) && node.elements.length) {
      out.push(renderElementor(node.elements));
    }
  }
  return out.filter(Boolean).join('\n');
}

function renderElementorWidget(node: Row): string {
  const type = str(node.widgetType).toLowerCase();
  const settings = (node.settings ?? {}) as Row;
  const parts: string[] = [];
  const title = str(settings.title || settings.heading);
  const subtitle = str(settings.sub_title || settings.subtitle);
  const description = str(settings.description);

  if (type.includes('heading') || type.includes('title')) {
    if (subtitle) parts.push(`<p>${rewriteMedia(subtitle)}</p>`);
    if (title) parts.push(`<h2>${rewriteMedia(title)}</h2>`);
    if (description) parts.push(`<div>${rewriteMedia(description)}</div>`);
  }

  if (type.includes('text') || type.includes('editor') || type.includes('wysiwyg')) {
    parts.push(rewriteMedia(settings.editor || settings.text || settings.content));
  }

  if (type.includes('image') && !type.includes('gallery')) {
    const url = str(settings.image?.url || settings.url);
    if (url) {
      parts.push(
        `<img src="${rewriteMedia(url)}" alt="${str(settings.image?.alt || settings.alt)}" />`,
      );
    }
  }

  if (type.includes('gallery') && Array.isArray(settings.gallery)) {
    for (const item of settings.gallery) {
      if (item?.url) parts.push(`<img src="${rewriteMedia(item.url)}" alt="${str(item.alt)}" />`);
    }
  }

  if (type.includes('button')) {
    const link = str(settings.link?.url || settings.url || settings.button_link);
    const text = str(settings.text || settings.button_text);
    if (text) parts.push(link ? `<a href="${rewriteMedia(link)}">${text}</a>` : `<p>${text}</p>`);
  }

  if (type.includes('icon-list') && Array.isArray(settings.icon_list)) {
    const items = settings.icon_list
      .map((item: Row) => (item?.text ? `<li>${rewriteMedia(item.text)}</li>` : ''))
      .filter(Boolean)
      .join('');
    if (items) parts.push(`<ul>${items}</ul>`);
  }

  const repeaters = [settings.tabs, settings.accordion, settings.items].filter(Array.isArray);
  for (const repeater of repeaters) {
    for (const item of repeater as Row[]) {
      if (!item) continue;
      const itemTitle = str(item.tab_title || item.title || item.accordion_title);
      const itemContent = str(item.tab_content || item.content || item.accordion_content || item.description);
      if (itemTitle) parts.push(`<h3>${rewriteMedia(itemTitle)}</h3>`);
      if (itemContent) parts.push(`<div>${rewriteMedia(itemContent)}</div>`);
    }
  }

  if (!parts.some(Boolean)) {
    for (const key of ['editor', 'content', 'description']) {
      if (settings[key]) parts.push(rewriteMedia(settings[key]));
    }
  }

  return parts.filter(Boolean).join('\n');
}

function pageContent(page: Row): string {
  const original = rewriteMedia(page.content);
  if (original.trim()) return original;
  const elementor = page.meta?._elementor_data;
  if (Array.isArray(elementor)) return rewriteMedia(renderElementor(elementor));
  return '';
}

function elementorHtmlFromMeta(meta: Row): string {
  const elementor = meta?._elementor_data;
  return Array.isArray(elementor) ? rewriteMedia(renderElementor(elementor)) : '';
}

function seoFromMeta(meta: Row, fallbackTitle: string): Record<string, unknown> {
  const robots = meta?.rank_math_robots;
  const noIndex = Array.isArray(robots)
    ? robots.map(String).includes('noindex')
    : str(robots).includes('noindex');
  return {
    title: str(meta?.rank_math_title) || fallbackTitle,
    description: str(meta?.rank_math_description),
    focusKeyword: str(meta?.rank_math_focus_keyword),
    canonical: str(meta?.rank_math_canonical_url),
    noIndex,
  };
}

function mapCategoryType(value: unknown): '' | 'country' | 'city' | 'attraction' {
  const text = str(value);
  return ['country', 'city', 'attraction'].includes(text) ? (text as 'country' | 'city' | 'attraction') : '';
}

function mapPageTemplate(value: unknown): string {
  const raw = str(value, 'default');
  const normalised = raw.replace(/^page-templates\//, '').replace(/\.php$/, '');
  const map: Record<string, string> = {
    home: 'home',
    destination: 'destination',
    attraction: 'attraction',
    faq: 'faq',
    'about-us': 'about',
    contact: 'contact',
    'guided-tours': 'guided-tours',
    'order-status': 'order-status',
    'reservation-page': 'reservation',
    'review-submit': 'review',
    support: 'support',
    'thank-you': 'order-status',
    'blog-archive': 'blog',
  };
  return map[normalised] ?? (normalised || 'default');
}

function mapProductStatus(value: unknown): string {
  const status = str(value, 'draft');
  return ['publish', 'draft', 'pending', 'private'].includes(status) ? status : 'draft';
}

const orderStatusMap: Record<string, string> = {
  'wc-pending': 'pending',
  'wc-processing': 'processing',
  'wc-on-hold': 'on-hold',
  'wc-booking-confirm': 'booking-confirm',
  'wc-completed': 'completed',
  'wc-cancelled': 'cancelled',
  'wc-refunded': 'refunded',
  'wc-failed': 'failed',
  'wc-checkout-draft': 'pending',
  'wc-fraud-review': 'fraud-review',
};

const paymentMethodMap: Record<string, string> = {
  redsys: 'redsys',
  stripe: 'stripe',
  ppcp: 'paypal',
  ppcp_card: 'paypal',
  paypal: 'paypal',
  bacs: 'bank_transfer',
  bank_transfer: 'bank_transfer',
  cod: 'cod',
  cash: 'cash',
};

function paymentStatusFor(status: string): string {
  if (['completed', 'processing', 'booking-confirm'].includes(status)) return 'paid';
  if (status === 'refunded') return 'refunded';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function time24(value: unknown): string {
  const text = str(value).trim();
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(text);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = match[3]?.toUpperCase();
  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function optionNestedMap(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((entry, index) => [String(index), entry]));
  }
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function passengersFrom(value: unknown): Row[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (entry && typeof entry === 'object' ? entry : {})).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => num(a) - num(b))
      .map((key) => (value as Row)[key])
      .filter((entry) => entry && typeof entry === 'object');
  }
  return [];
}

function mapPassenger(entry: Row, index: number): Row {
  return {
    firstName: str(entry.first_name ?? entry.firstName),
    lastName: str(entry.last_name ?? entry.lastName),
    passport: str(entry.passport),
    nationality: str(entry.nationality),
    passportExpiry: str(entry.passport_expiry ?? entry.passportExpiry),
    birthDate: str(entry.birth_date ?? entry.birthDate),
    isLead: index === 0,
  };
}

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function insertAll(model: any, docs: Row[], label: string): Promise<void> {
  let inserted = 0;
  for (const chunk of chunked(docs)) {
    if (!chunk.length) continue;
    await model.insertMany(chunk, { ordered: true });
    inserted += chunk.length;
  }
  console.log(`[migrate] ${label}: ${inserted}`);
}

async function clearContent(): Promise<void> {
  if (!FRESH) return;
  console.log('[migrate] clearing existing content');
  await Promise.all([
    Product.deleteMany({}),
    Category.deleteMany({}),
    BlogCategory.deleteMany({}),
    Taxonomy.deleteMany({}),
    Review.deleteMany({}),
    Showcase.deleteMany({}),
    Page.deleteMany({}),
    Post.deleteMany({}),
    Coupon.deleteMany({}),
    Order.deleteMany({}),
    FraudEvent.deleteMany({}),
  ]);
}

async function importUsers(): Promise<void> {
  const wpEmails = new Set(data.users.map((user) => str(user.email).toLowerCase()).filter(Boolean));
  const keepEmails = new Set([env.ADMIN_EMAIL.toLowerCase(), ...wpEmails]);
  const roleMap: Record<string, 'admin' | 'manager' | 'customer'> = {
    administrator: 'admin',
    shop_manager: 'manager',
    editor: 'manager',
    author: 'customer',
    contributor: 'customer',
    subscriber: 'customer',
    customer: 'customer',
  };

  for (const wpUser of data.users) {
    const email = str(wpUser.email).toLowerCase();
    if (!email) continue;
    const existing = await User.findOne({ email });
    const roles = Array.isArray(wpUser.roles) ? wpUser.roles.map(String) : [];
    const role =
      roles.map((item) => roleMap[item]).find(Boolean) ?? 'customer';
    const meta = (wpUser.meta ?? {}) as Row;
    const firstName = str(wpUser.firstName);
    const lastName = str(wpUser.lastName);
    const displayName = str(wpUser.displayName) || `${firstName} ${lastName}`.trim() || str(wpUser.login);
    const phone = str(wpUser.phone);
    const billing = {
      label: 'Billing',
      firstName,
      lastName,
      address1: str(meta.billing_address_1),
      address2: str(meta.billing_address_2),
      city: str(meta.billing_city),
      state: str(meta.billing_state),
      postcode: str(meta.billing_postcode),
      country: str(meta.billing_country),
      phone,
      isDefault: true,
    };
    const shipping = {
      label: 'Shipping',
      firstName,
      lastName,
      address1: str(meta.shipping_address_1),
      address2: str(meta.shipping_address_2),
      city: str(meta.shipping_city),
      state: str(meta.shipping_state),
      postcode: str(meta.shipping_postcode),
      country: str(meta.shipping_country),
      phone,
      isDefault: false,
    };
    const hasBilling = Object.entries(billing).some(([key, value]) => key !== 'label' && key !== 'isDefault' && Boolean(value));
    const hasShipping = Object.entries(shipping).some(([key, value]) => key !== 'label' && key !== 'isDefault' && Boolean(value));
    const addresses = [hasBilling ? billing : null, hasShipping ? shipping : null].filter(Boolean);
    const payload = {
      email,
      firstName,
      lastName,
      displayName,
      phone,
      role,
      isActive: true,
      emailVerified: true,
      addresses,
      billingAddress: hasBilling ? billing : undefined,
      shippingAddress: hasShipping ? shipping : undefined,
      locale: str(wpUser.locale) || 'en',
      currency: str(data.options.woocommerce_currency) || 'EUR',
      source: 'wordpress',
      metadata: {
        wpUserId: wpUser.id,
        wpLogin: wpUser.login,
        wpRoles: roles,
        wpRegistered: wpUser.registered,
        wordpressImport: true,
      },
    };

    if (existing) {
      await User.updateOne({ _id: existing._id }, { $set: payload });
      userByWpId.set(Number(wpUser.id), existing._id as Types.ObjectId);
    } else {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const doc = await User.create({
        _id: oid('user', wpUser.id),
        ...payload,
        passwordHash,
        createdAt: dateAt(wpUser.registered),
        updatedAt: dateAt(wpUser.registered),
      });
      userByWpId.set(Number(wpUser.id), doc._id as Types.ObjectId);
    }
  }

  if (FRESH) {
    const removed = await User.deleteMany({ email: { $nin: [...keepEmails] } });
    console.log(`[migrate] removed ${removed.deletedCount ?? 0} non-WordPress users`);
  }
  console.log(`[migrate] users: ${data.users.length}`);
}

async function importCategories(): Promise<void> {
  const terms = (data.terms.product_cat ?? []).slice().sort((a, b) => num(a.parent) - num(b.parent));
  const docs = terms.map((term) => {
    const _id = oid('category', term.id);
    categoryByWpId.set(Number(term.id), _id);
    const meta = (term.meta ?? {}) as Row;
    return {
      _id,
      name: str(term.name),
      slug: str(term.slug),
      parentId: num(term.parent) > 0 ? oid('category', num(term.parent)) : null,
      description: htmlText(term.description),
      categoryType: mapCategoryType(meta.category_type),
      categoryPageLink: rewriteMedia(meta.category_page_link),
      topExperience: bool(meta.top_experience),
      topAttraction: bool(meta.top_attraction),
      image: imageUrl(meta.thumbnail_id),
      icon: str(meta.icon),
      productCount: num(term.count),
      order: num(meta.order),
      meta,
      seo: {
        title: str(meta.rank_math_title),
        description: str(meta.rank_math_description),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  await insertAll(Category, docs, 'product categories');
}

async function importTaxonomies(): Promise<void> {
  const docs: Row[] = [];
  for (const kind of ['product_tag', 'activity_type'] as const) {
    const prefix = kind === 'product_tag' ? 'tag' : 'activity';
    for (const term of data.terms[kind] ?? []) {
      const _id = oid('taxonomy', term.id);
      taxonomyByWpId.set(Number(term.id), _id);
      const meta = (term.meta ?? {}) as Row;
      const baseSlug = str(term.slug) || slugify(str(term.name), { lower: true, strict: true });
      docs.push({
        _id,
        name: str(term.name),
        slug: `${prefix}-${baseSlug}`,
        kind,
        parentId: num(term.parent) > 0 ? oid('taxonomy', num(term.parent)) : null,
        description: htmlText(term.description),
        image: imageUrl(meta.thumbnail_id),
        productCount: num(term.count),
        order: num(meta.order),
        meta,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
  await insertAll(Taxonomy, docs, 'taxonomies');
}

function mapProductOptions(product: Row): Row[] {
  const raw = product.meta?._ttf_product_options;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: Row) => {
    const lastDays = (entry.lastdays ?? entry.last_days ?? {}) as Row;
    return {
      name: str(entry.name, 'Standard'),
      details: rewriteMedia(entry.details),
      type: str(entry.type, 'Single Day'),
      capacity: num(entry.capacity),
      active: bool(entry.active),
      startDate: str(entry.startdate ?? entry.start_date),
      endDate: str(entry.enddate ?? entry.end_date),
      repeat: Array.isArray(entry.repeat) ? entry.repeat.map(String) : undefined,
      startTime: Array.isArray(entry.starttime)
        ? entry.starttime.map(time24)
        : Array.isArray(entry.start_time)
          ? entry.start_time.map(time24)
          : [],
      prices: (Array.isArray(entry.prices) ? entry.prices : []).map((price: Row) => {
        const category = str(price.category, 'Adult');
        const amount = Math.max(0, num(price.price));
        return {
          category,
          ageFrom: num(price.age_from ?? price.ageFrom),
          ageTo: num(price.age_to ?? price.ageTo),
          buyingPrice: amount,
          serviceCharge: 0,
          tax: 0,
          price: amount,
        };
      }),
      lastDays: { days: num(lastDays.days), percent: num(lastDays.percent) },
      duration: str(entry.duration),
      cutoff: num(entry.cutoff),
      languages: Array.isArray(entry.languages) ? entry.languages.map(String) : [],
    };
  });
}

function ratingCounts(value: unknown): Row {
  const counts: Row = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (value && typeof value === 'object') {
    for (const key of ['1', '2', '3', '4', '5']) counts[key] = num((value as Row)[key]);
  }
  return counts;
}

function productHighlights(meta: Row): string[] {
  const html = str(meta.highlights);
  if (!html) return [];
  return [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => htmlText(match[1]))
    .filter(Boolean)
    .slice(0, 20);
}

async function importProducts(): Promise<void> {
  const docs = data.products.map((product) => {
    const _id = oid('product', product.id);
    productByWpId.set(Number(product.id), _id);
    const meta = (product.meta ?? {}) as Row;
    const relations = (product.terms ?? {}) as Row;
    const categoryIds = (relations.product_cat ?? [])
      .map((id: number) => categoryByWpId.get(num(id)))
      .filter(Boolean);
    const tagIds = (relations.product_tag ?? [])
      .map((id: number) => taxonomyByWpId.get(num(id)))
      .filter(Boolean);
    const activityTypeIds = (relations.activity_type ?? [])
      .map((id: number) => taxonomyByWpId.get(num(id)))
      .filter(Boolean);

    const imageIds = [product.thumbnailId, ...(product.galleryIds ?? [])].map(num).filter((id) => id > 0);
    const images = imageIds.map(imageRecord).filter(Boolean).slice(0, 1);
    const gallery = imageIds
      .slice(1)
      .map(imageUrl)
      .filter(Boolean);

    const options = mapProductOptions(product);
    const price = num(product.price);
    const regularPrice = num(product.regularPrice, price);
    const salePrice = num(product.salePrice);
    const reviewCount = num(product.reviewCount);
    const averageRating = num(product.averageRating);
    const counts = ratingCounts(product.ratingCounts);
    const highlights = productHighlights(meta);
    const keyDuration = str(meta.key_points_duration) || str(options[0]?.duration);
    const skipTheLine =
      str(meta.key_points_skip_the_line_line) ||
      (bool(meta.key_points_skip_the_line_check) ? 'Skip the line' : str(meta.key_points_skip_the_line));
    const guideType = listItems(meta.key_points_select_guide_type_guide_type).join(', ') ||
      listItems(meta.key_points_select_guide_type).join(', ') ||
      str(meta.key_points_guide_type);
    const importantContent = str(meta.know_before_you_go) || str(meta.important_information_content);
    const importantTitle = str(meta.important_information_title) || 'Know before you go';
    const description = rewriteMedia(product.content) || rewriteMedia(meta.description);
    const shortDescription = htmlText(product.excerpt) || htmlText(description).slice(0, 280);

    return {
      _id,
      title: str(product.title) || `Untitled product ${product.id}`,
      slug: uniqueProductSlug(str(product.slug || product.title || `product-${product.id}`), num(product.id)),
      sku: str(product.sku),
      status: mapProductStatus(product.status),
      type: ['simple', 'variable', 'external', 'grouped'].includes(str(product.type, 'simple'))
        ? str(product.type, 'simple')
        : 'simple',
      shortDescription,
      description,
      content: description,
      price,
      regularPrice,
      salePrice,
      onSale: salePrice > 0 && regularPrice > 0 && salePrice < regularPrice,
      currency: str(data.options.woocommerce_currency) || 'EUR',
      images,
      gallery,
      categoryIds,
      tagIds,
      activityTypeIds,
      productOptions: options,
      unavailableSlots: optionNestedMap(meta._ttf_unavailable_slots),
      slotQuantities: optionNestedMap(meta._ttf_slot_quantities),
      passportRequirement: ['none', 'single', 'all'].includes(str(meta._ttf_passport_requirement))
        ? str(meta._ttf_passport_requirement)
        : 'none',
      keyPoints: {
        cancellationPolicy: str(meta.key_points_cancellation_policy),
        duration: keyDuration,
        lastMinuteAvailability: str(meta.key_points_last_minute_availability),
        wheelchairAccessible: str(meta.key_points_wheelchair_accessible),
        skipTheLine,
        guideType,
        highlights,
      },
      importantInformation: {
        title: importantContent ? importantTitle : '',
        content: rewriteMedia(importantContent),
      },
      liveTourGuide: {
        title: str(meta.live_tour_guide_title),
        content: rewriteMedia(meta.live_tour_guide_content),
      },
      trekksoftButtonLink: str(meta.trekksoft_button_link),
      highlightedText: str(meta.highlighted_text),
      highlightedQuantityText: str(meta.highlighted_quantity_text),
      rating: { average: averageRating, count: reviewCount, rated: reviewCount, counts },
      bookingCount: num(meta.total_sales),
      soldCount: num(meta.total_sales),
      attributes: [],
      seo: seoFromMeta(meta, str(product.title)),
      order: num(product.menuOrder),
      isFeatured: bool(product.isFeatured),
      metadata: {
        wpId: product.id,
        source: 'wordpress',
        highlightsHtml: rewriteMedia(meta.highlights),
        includedHtml: rewriteMedia(meta.includeexclude_include),
        excludedHtml: rewriteMedia(meta.includeexclude_exclude),
        knowBeforeYouGoHtml: rewriteMedia(meta.know_before_you_go),
        meetingPoint: {
          description: htmlText(meta.meeting_point_description),
          map: str(meta.meeting_point_map),
        },
      },
      createdAt: dateAt(product.date),
      updatedAt: dateAt(product.modified, dateAt(product.date)),
    };
  });
  await insertAll(Product, docs, 'products');
}

async function importBlogCategories(): Promise<void> {
  const docs = (data.terms.category ?? []).map((term) => {
    const _id = oid('blogCategory', term.id);
    blogCategoryByWpId.set(Number(term.id), _id);
    return {
      _id,
      name: str(term.name),
      slug: str(term.slug) || slugify(str(term.name), { lower: true, strict: true }) || `category-${term.id}`,
      parentId: num(term.parent) > 0 ? oid('blogCategory', num(term.parent)) : null,
      description: htmlText(term.description),
      image: imageUrl((term.meta as Row | undefined)?.thumbnail_id),
      postCount: num(term.count),
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  await insertAll(BlogCategory, docs, 'blog categories');
}

async function importPosts(): Promise<void> {
  const docs = data.posts.map((post) => {
    const meta = (post.meta ?? {}) as Row;
    const content = rewriteMedia(post.content);
    const relatedProductIds = parseIds(meta._related_products)
      .map((id) => productByWpId.get(id))
      .filter(Boolean);
    const author = data.users.find((user) => num(user.id) === num(post.authorId));
    const relations = (post.terms ?? {}) as Row;
    const categoryIds = (relations.category ?? [])
      .map((id: number) => blogCategoryByWpId.get(num(id)))
      .filter(Boolean);
    return {
      _id: oid('post', post.id),
      title: str(post.title) || `Untitled post ${post.id}`,
      slug: str(post.slug) || slugify(str(post.title), { lower: true, strict: true }) || `post-${post.id}`,
      status: mapProductStatus(post.status),
      excerpt: htmlText(post.excerpt) || htmlText(content).slice(0, 280),
      content,
      contentHtml: content,
      authorName: str(author?.displayName),
      image: imageUrl(post.thumbnailId),
      gallery: [],
      categoryIds,
      tagIds: [],
      relatedProductIds,
      commentCount: num(post.commentCount),
      viewCount: num(meta._eael_post_view_count),
      readingMinutes: Math.max(1, Math.round(htmlText(content).split(' ').length / 200)),
      seo: seoFromMeta(meta, str(post.title)),
      createdAt: dateAt(post.date),
      updatedAt: dateAt(post.modified, dateAt(post.date)),
    };
  });
  await insertAll(Post, docs, 'posts');
}

async function importPages(): Promise<void> {
  const docs = data.pages.map((page) => {
    const meta = (page.meta ?? {}) as Row;
    const content = pageContent(page);
    const gallery = Array.isArray(meta._gallery_data)
      ? meta._gallery_data
          .map((item: Row) => rewriteMedia(item?.image))
          .filter(Boolean)
      : [];
    const whyVisitUsCards = Array.isArray(meta._why_visit_us_cards)
      ? meta._why_visit_us_cards
          .map((item: Row) => ({
            title: htmlText(item?.title),
            description: htmlText(item?.description ?? item?.content),
          }))
          .filter((item: Row) => item.title || item.description)
      : [];
    return {
      _id: oid('page', page.id),
      title: str(page.title) || `Untitled page ${page.id}`,
      slug: str(page.slug) || slugify(str(page.title), { lower: true, strict: true }) || `page-${page.id}`,
      status: mapProductStatus(page.status),
      template: mapPageTemplate(meta._wp_page_template),
      content,
      excerpt: htmlText(page.excerpt) || htmlText(content).slice(0, 280),
      image: imageUrl(page.thumbnailId),
      selectedCategoryId: num(page.selectedCategoryId) > 0
        ? categoryByWpId.get(num(page.selectedCategoryId)) ?? null
        : null,
      selectedTagId: num(page.selectedProductTagId) > 0
        ? taxonomyByWpId.get(num(page.selectedProductTagId)) ?? null
        : null,
      whyVisitUs: {
        title: htmlText(meta._why_visit_us_title),
        cards: whyVisitUsCards,
      },
      gallery,
      seo: seoFromMeta(meta, str(page.title)),
      createdAt: dateAt(page.date),
      updatedAt: dateAt(page.modified, dateAt(page.date)),
    };
  });
  await insertAll(Page, docs, 'pages');
}

async function importShowcases(): Promise<void> {
  const categoryByName = new Map<string, Row>();
  for (const category of data.terms.product_cat ?? []) {
    categoryByName.set(htmlText(category.name).toLowerCase(), category);
  }

  const docs: Row[] = [];
  for (const showcase of data.showcases) {
    const meta = (showcase.meta ?? {}) as Row;
    const kind = str(showcase.kind) === 'destination' ? 'destination' : 'attraction';
    const raw = meta[`${kind === 'destination' ? 'top_destinations' : 'top_attractions'}_items`];
    const list: Row[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.keys(raw)
            .sort((a, b) => num(a) - num(b))
            .map((key) => (raw as Row)[key])
            .filter(Boolean)
        : [];
    const items = list.map((item, index) => {
      const title = htmlText(item?.name ?? item?.title);
      const category = categoryByName.get(title.toLowerCase());
      const categorySlug = category ? str(category.slug) : '';
      const link = categorySlug
        ? `/categories/${categorySlug}`
        : `/products?search=${encodeURIComponent(title)}`;
      return {
        title,
        subtitle: htmlText(item?.subtitle),
        description: htmlText(item?.description),
        image: rewriteMedia(item?.image),
        link,
        pageTitle: str(item?.page_title || title),
        productId: null,
        order: index,
      };
    });
    docs.push({
      _id: oid('showcase', showcase.id),
      kind,
      title: str(showcase.title),
      slug: str(showcase.slug),
      status: str(showcase.status) === 'publish' ? 'publish' : 'draft',
      subtitle: htmlText(meta.subtitle),
      description: htmlText(meta.description),
      items,
      meta: {
        wpId: showcase.id,
        source: 'wordpress',
      },
      createdAt: dateAt(showcase.date),
      updatedAt: dateAt(showcase.modified, dateAt(showcase.date)),
    });
  }
  await insertAll(Showcase, docs, 'showcases');
}

function orderItemsFor(order: Row): { items: Row[]; subtotal: number; travelerCount: number } {
  let subtotal = 0;
  let travelerCount = 0;
  const items: Row[] = [];
  for (const item of order.items ?? []) {
    if (str(item.type) !== 'line_item') continue;
    const meta = (item.meta ?? {}) as Row;
    const productWpId = num(meta._product_id);
    const productId = productByWpId.get(productWpId);
    if (!productId) continue;
    const product = data.products.find((entry) => num(entry.id) === productWpId);
    const qty = Math.max(1, num(meta._qty, 1));
    const lineTotal = num(meta._line_total, num(meta['Dynamic Price']));
    const travelers = {
      Adult: num(meta.Adult),
      Child: num(meta.Child),
      Infant: num(meta.Infant),
      Youth: num(meta.Youth),
      Senior: num(meta.Senior),
    };
    const lineTravelers = Object.values(travelers).reduce((sum, value) => sum + num(value), 0) || qty;
    subtotal += num(meta._line_subtotal, lineTotal);
    travelerCount += lineTravelers;
    items.push({
      productId,
      productSlug: str(product?.slug),
      productTitle: str(product?.title, item.name),
      productImage: imageUrl(product?.thumbnailId),
      optionIndex: num(meta['Option Index']),
      optionName: str(meta['Option Name']),
      details: rewriteMedia(meta.Details),
      duration: str(meta.Duration),
      date: str(meta.Date),
      time: time24(meta.Time),
      language: str(meta.Language),
      travelers,
      travelerCount: lineTravelers,
      unitPrice: Math.round((lineTotal / qty) * 100) / 100,
      dynamicPrice: num(meta['Dynamic Price']),
      total: lineTotal,
      priceBreakdown: meta,
      lineExtras: [],
    });
  }
  return { items, subtotal: Math.round(subtotal * 100) / 100, travelerCount };
}

async function importOrders(): Promise<void> {
  const docs = data.orders.map((order) => {
    const _id = oid('order', order.id);
    orderByWpId.set(Number(order.id), _id);
    const meta = (order.meta ?? {}) as Row;
    const addresses = (order.addresses ?? {}) as Row;
    const billingAddress = (addresses.billing ?? {}) as Row;
    const shippingAddress = (addresses.shipping ?? {}) as Row;
    const billingEmail = str(order.billingEmail || billingAddress.email).toLowerCase();
    const status = orderStatusMap[str(order.status)] ?? 'pending';
    const createdAt = dateAt(order.dateCreated);
    const updatedAt = dateAt(order.dateUpdated, createdAt);
    const { items, subtotal, travelerCount } = orderItemsFor(order);
    const paymentMethod = paymentMethodMap[str(order.paymentMethod)] ?? 'cod';
    const operational = (order.operational ?? {}) as Row;
    const passengers = passengersFrom(meta._ttf_final_passengers).map(mapPassenger);
    const noteLines = (order.notes ?? []).map((note: Row) =>
      `[${str(note.date)}] ${str(note.author)}: ${htmlText(note.content)}`,
    );
    const customerEmail = billingEmail || `${str(order.id)}@guest.tourstravelfinder.local`;
    const billing = {
      firstName: str(billingAddress.first_name),
      lastName: str(billingAddress.last_name),
      email: billingEmail || customerEmail,
      phone: str(billingAddress.phone),
      country: str(billingAddress.country),
      address1: str(billingAddress.address_1),
      address2: str(billingAddress.address_2),
      city: str(billingAddress.city),
      state: str(billingAddress.state),
      postcode: str(billingAddress.postcode),
      company: str(billingAddress.company),
    };
    const hasShipping = Object.values(shippingAddress).some((value) => Boolean(value));
    const shipping = hasShipping
      ? {
          firstName: str(shippingAddress.first_name),
          lastName: str(shippingAddress.last_name),
          country: str(shippingAddress.country),
          address1: str(shippingAddress.address_1),
          address2: str(shippingAddress.address_2),
          city: str(shippingAddress.city),
          state: str(shippingAddress.state),
          postcode: str(shippingAddress.postcode),
        }
      : {};
    const fraudLevel = ['allowed', 'review', 'blocked'].includes(str(meta._ttf_fraud_level))
      ? str(meta._ttf_fraud_level)
      : 'allowed';

    return {
      _id,
      orderNumber: str(order.id),
      status,
      paymentStatus: paymentStatusFor(status),
      paymentMethod,
      transactionId: str(order.transactionId),
      currency: str(order.currency, 'EUR'),
      subtotal,
      discountTotal: num(operational.discount_total_amount),
      feeTotal: 0,
      shippingTotal: num(operational.shipping_total_amount),
      taxTotal: num(order.taxAmount),
      total: num(order.totalAmount),
      refunds: num(meta._refund_amount),
      items,
      userId: num(order.customerId) > 0 ? userByWpId.get(num(order.customerId)) ?? null : null,
      customerEmail,
      customerPhone: str(billingAddress.phone),
      billing,
      shipping,
      travelerCount: travelerCount || num(meta._ttf_traveler_count, 1),
      passengers,
      extras: [],
      pickupOption: '',
      departureOption: '',
      couponCode: str(meta._coupon_code),
      ticketFiles: [],
      slotsReduced: false,
      cancelRequested: false,
      cancelReason: '',
      reviewEnabled: false,
      reviewToken: '',
      fraud: {
        level: fraudLevel,
        score: num(meta._ttf_fraud_score),
        reasons: listItems(meta._ttf_fraud_reasons),
        reviewed: bool(meta._ttf_fraud_reviewed),
        ip: str(meta._ttf_fs_ip),
        ipHash: str(meta._ttf_fs_ip_hash),
        emailHash: str(meta._ttf_fs_email_hash),
        phoneHash: str(meta._ttf_fs_phone_hash),
        fingerprint: str(meta._ttf_fs_fingerprint),
        fingerprintHash: str(meta._ttf_fs_fingerprint_hash),
        fingerprintSource: str(meta._ttf_fs_fingerprint_source),
        productKeys: listItems(meta._ttf_fs_product_keys),
        sessionId: str(meta._ttf_fs_session_id),
        context: {},
      },
      attribution: {
        sourceType: str(meta._wc_order_attribution_source_type, 'direct'),
        referrer: str(meta._wc_order_attribution_referrer),
        utmSource: str(meta._wc_order_attribution_utm_source),
        utmMedium: str(meta._wc_order_attribution_utm_medium),
        utmCampaign: str(meta._wc_order_attribution_utm_campaign),
        sessionEntry: str(meta._wc_order_attribution_session_entry),
        sessionPages: num(meta._wc_order_attribution_session_pages),
        deviceType: str(meta._wc_order_attribution_device_type, 'desktop'),
      },
      notes: str(order.customerNote),
      adminNotes: noteLines.join('\n'),
      meta: {
        wpId: order.id,
        source: 'wordpress',
        wpStatus: str(order.status),
        wpType: str(order.type),
        wpOperational: operational,
        wpMeta: meta,
        wpNotes: order.notes ?? [],
      },
      createdAt,
      updatedAt,
    };
  });
  await insertAll(Order, docs, 'orders');

  const totals = new Map<string, { totalSpent: number; orderCount: number }>();
  for (const order of docs) {
    if (!order.userId) continue;
    const key = String(order.userId);
    const entry = totals.get(key) ?? { totalSpent: 0, orderCount: 0 };
    entry.orderCount += 1;
    if (['completed', 'processing', 'booking-confirm'].includes(order.status)) {
      entry.totalSpent += num(order.total);
    }
    totals.set(key, entry);
  }
  for (const [userId, totalsEntry] of totals) {
    await User.updateOne(
      { _id: userId },
      { $set: { totalSpent: Math.round(totalsEntry.totalSpent * 100) / 100, orderCount: totalsEntry.orderCount } },
    );
  }
}

async function importReviews(): Promise<void> {
  const docs = data.reviews.map((review): Row | null => {
    const productId = productByWpId.get(num(review.productId));
    if (!productId) return null;
    const approved = str(review.approved);
    const status = approved === '1' ? 'approved' : approved === '0' ? 'pending' : approved === 'spam' ? 'spam' : 'rejected';
    return {
      _id: oid('review', review.id),
      productId,
      userId: num(review.userId) > 0 ? userByWpId.get(num(review.userId)) ?? null : null,
      authorName: str(review.authorName),
      authorEmail: str(review.authorEmail).toLowerCase(),
      authorAvatar: '',
      rating: num(review.rating, 5),
      title: '',
      content: htmlText(review.content),
      status,
      source: bool(review.verified) ? 'customer' : 'manual',
      verifiedBooking: bool(review.verified),
      orderId: null,
      images: [],
      helpfulCount: 0,
      ipHash: str(review.authorIp),
      moderatedBy: 'wordpress-import',
      createdAt: dateAt(review.date),
      updatedAt: dateAt(review.date),
    };
  }).filter((entry): entry is Row => entry !== null);
  await insertAll(Review, docs, 'reviews');
}

function mapFaqCategory(section: string, question: string, categories: Row[]): Row | undefined {
  const text = `${section} ${question}`.toLowerCase();
  const byName = (fragment: string) =>
    categories.find((category) => str(category.name).toLowerCase().includes(fragment));
  if (text.includes('payment') || text.includes('refund') || text.includes('price') || text.includes('discount')) {
    return byName('payment') ?? byName('booking');
  }
  if (text.includes('cancel')) return byName('cancellation');
  if (text.includes('meeting') || text.includes('pickup') || text.includes('late')) {
    return byName('meeting');
  }
  if (text.includes('personal') || text.includes('privacy') || text.includes('data')) {
    return byName('data');
  }
  if (text.includes('booking') || text.includes('voucher') || text.includes('confirmation')) {
    return byName('booking');
  }
  if (text.includes('activity') || text.includes('tour') || text.includes('restriction') || text.includes('group')) {
    return byName('activity');
  }
  return categories.find((category) => str(category.name).toLowerCase().includes('plan')) ?? categories[0];
}

async function importFaqs(): Promise<void> {
  const faqPage = data.pages.find((page) => str(page.slug) === 'faq');
  if (!faqPage) return;
  const html = pageContent(faqPage);
  if (!html) return;

  const headingMatches = [...html.matchAll(/<h([24])[^>]*>([\s\S]*?)<\/h\1>/gi)];
  if (!headingMatches.length) return;

  const categories: Row[] = (data.terms.faq_category ?? []).map((term) => ({
    ...term,
    _id: oid('faqCategory', term.id),
  }) as Row);
  const faqRows: Row[] = [];
  let section = '';

  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index]!;
    const level = match[1];
    const title = htmlText(match[2]);
    const start = (match.index ?? 0) + match[0].length;
    const end = headingMatches[index + 1]?.index ?? html.length;
    if (level === '2') {
      section = title;
      continue;
    }
    if (!title) continue;
    const answer = html.slice(start, end).replace(/<h[24][^>]*>\s*<\/h[24]>/gi, '').trim();
    if (htmlText(answer).length < 20) continue;
    const category = mapFaqCategory(section, title, categories);
    faqRows.push({
      _id: oid('faq', `${faqRows.length}:${title}`),
      title: title.replace(/^\d+\.\s*/, '').trim(),
      slug: slugify(title.replace(/^\d+\.\s*/, ''), { lower: true, strict: true }).slice(0, 160) ||
        `faq-${faqRows.length + 1}`,
      status: 'publish',
      content: rewriteMedia(answer),
      excerpt: htmlText(answer).slice(0, 300),
      categoryIds: category ? [category._id] : [],
      order: faqRows.length,
      meta: { source: 'wordpress', section },
      createdAt: dateAt(faqPage.modified, dateAt(faqPage.date)),
      updatedAt: dateAt(faqPage.modified, dateAt(faqPage.date)),
    });
  }

  if (!faqRows.length) return;
  if (FRESH) {
    await Promise.all([Faq.deleteMany({}), FaqCategory.deleteMany({})]);
  }
  const categoryDocs = categories.map((category) => ({
    _id: category._id,
    name: str(category.name),
    slug: str(category.slug),
    parentId: num(category.parent) > 0 ? oid('faqCategory', num(category.parent)) : null,
    description: htmlText(category.description),
    order: 0,
    faqCount: faqRows.filter((faq) => faq.categoryIds[0] === category._id).length,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await insertAll(FaqCategory, categoryDocs, 'FAQ categories');
  await insertAll(Faq, faqRows, 'FAQs');
}

async function importFraudEvents(): Promise<void> {
  const docs = data.fraudEvents.map((event) => ({
    _id: oid('fraudEvent', event.id),
    eventType: str(event.eventType, 'checkout'),
    orderId: num(event.orderId) > 0 ? orderByWpId.get(num(event.orderId)) ?? null : null,
    userId: null,
    status: str(event.status, 'allowed'),
    riskScore: num(event.riskScore),
    ipHash: str(event.ipHash),
    emailHash: str(event.emailHash),
    phoneHash: str(event.phoneHash),
    fingerprintHash: str(event.fingerprintHash),
    productKeys: listItems(event.productKeys),
    reasons: listItems(event.reasons),
    context: event.context ?? {},
    createdAt: dateAt(event.createdAt),
    updatedAt: dateAt(event.createdAt),
  }));
  await insertAll(FraudEvent, docs, 'fraud events');
}

async function importCoupons(): Promise<void> {
  const docs = data.coupons.map((coupon) => {
    const meta = (coupon.meta ?? {}) as Row;
    const type = str(meta.discount_type);
    return {
      _id: oid('coupon', coupon.id),
      code: str(coupon.code),
      type: ['fixed_cart', 'percent', 'fixed_product'].includes(type) ? type : 'fixed_cart',
      amount: num(meta.coupon_amount),
      description: str(coupon.description),
      dateExpires: meta.date_expires ? dateAt(new Date(num(meta.date_expires) * 1000).toISOString()) : undefined,
      usageCount: num(meta.usage_count),
      usageLimit: num(meta.usage_limit),
      usageLimitPerUser: num(meta.usage_limit_per_user),
      minimumAmount: num(meta.minimum_amount),
      maximumAmount: num(meta.maximum_amount),
      individualUse: bool(meta.individual_use),
      excludeSaleItems: bool(meta.exclude_sale_items),
      freeShipping: bool(meta.free_shipping),
      active: str(coupon.status) === 'publish',
      createdAt: dateAt(coupon.date),
      updatedAt: dateAt(coupon.modified, dateAt(coupon.date)),
    };
  }).filter((coupon) => coupon.code);
  await insertAll(Coupon, docs, 'coupons');
}

async function importSettings(): Promise<void> {
  const current = await getSiteSettings();
  const wpEmail = str(data.options.ssl_zen_email);
  const wpMail = str(data.options.woocommerce_email_from_address);
  const siteName = str(data.options.blogname) || current.siteName;
  const mailFromAddress = wpMail && !wpMail.endsWith('.local') ? wpMail : wpEmail || current.mailFromAddress;
  const site: SiteSettings = {
    ...current,
    siteName,
    siteUrl: env.SITE_URL,
    supportEmail: wpEmail || current.supportEmail,
    adminEmail: env.ADMIN_EMAIL,
    currency: str(data.options.woocommerce_currency) || current.currency,
    mailFromName: siteName,
    mailFromAddress,
    seo: {
      ...current.seo,
      title: `${siteName} - Tours, Tickets & Experiences`,
      description: str(data.options.blogdescription) || current.seo.description,
    },
  };
  await saveSiteSettings(site);

  const wpPromo = (data.options.ttf_promo_options ?? {}) as Row;
  const promo: PromoSettings = {
    showBanner: bool(wpPromo.show_banner),
    title: str(wpPromo.title),
    offerText: str(wpPromo.offer_text),
    buttonText: str(wpPromo.button_text),
    buttonLink: str(wpPromo.button_link),
    bgImage: rewriteMedia(wpPromo.bg_image),
    productType: ['category', 'tag', 'products'].includes(str(wpPromo.product_type))
      ? (str(wpPromo.product_type) as PromoSettings['productType'])
      : 'category',
    category: (Array.isArray(wpPromo.category) ? wpPromo.category : [])
      .map((id) => categoryByWpId.get(num(id)))
      .filter(Boolean)
      .map(String),
    tag: (Array.isArray(wpPromo.tag) ? wpPromo.tag : [])
      .map((id) => taxonomyByWpId.get(num(id)))
      .filter(Boolean)
      .map(String),
    productIds: (Array.isArray(wpPromo.products) ? wpPromo.products : [])
      .map((id) => productByWpId.get(num(id)))
      .filter(Boolean)
      .map(String),
  };
  await savePromoSettings(promo);

  const wpFomo = (data.options.ttf_fomo_entries ?? []) as Row[];
  await saveFomoSettings({
    enabled: bool(data.options.ttf_fomo_enabled),
    entries: wpFomo.map((entry) => ({
      person: str(entry.person),
      country: str(entry.country),
      productIds: (Array.isArray(entry.products) ? entry.products : [])
        .map((id) => productByWpId.get(num(id)))
        .filter(Boolean)
        .map(String),
    })),
  });

  const wpFraud = (data.options.ttf_fraud_settings ?? {}) as Row;
  const fraud: FraudSettings = {
    ...DEFAULT_FRAUD_SETTINGS,
    enabled: wpFraud.enabled === undefined ? DEFAULT_FRAUD_SETTINGS.enabled : bool(wpFraud.enabled),
    reviewThreshold: num(wpFraud.review_threshold, DEFAULT_FRAUD_SETTINGS.reviewThreshold),
    blockThreshold: num(wpFraud.block_threshold, DEFAULT_FRAUD_SETTINGS.blockThreshold),
    velocityWindowMinutes: num(wpFraud.velocity_window_minutes, DEFAULT_FRAUD_SETTINGS.velocityWindowMinutes),
    maxIpAttempts: num(wpFraud.max_ip_attempts, DEFAULT_FRAUD_SETTINGS.maxIpAttempts),
    maxFingerprintAttempts: num(
      wpFraud.max_fingerprint_attempts,
      DEFAULT_FRAUD_SETTINGS.maxFingerprintAttempts,
    ),
    maxEmailAttempts: num(wpFraud.max_email_attempts, DEFAULT_FRAUD_SETTINGS.maxEmailAttempts),
    duplicateWindowMinutes: num(wpFraud.duplicate_window_minutes, DEFAULT_FRAUD_SETTINGS.duplicateWindowMinutes),
    duplicateProductLimit: num(wpFraud.duplicate_product_limit, DEFAULT_FRAUD_SETTINGS.duplicateProductLimit),
    blockedIps: listItems(wpFraud.blocked_ips),
    blockedEmails: listItems(wpFraud.blocked_emails),
    blockedFingerprints: listItems(wpFraud.blocked_fingerprints),
    blockedDomains: listItems(wpFraud.blocked_domains),
    disposableDomains: listItems(wpFraud.disposable_domains),
    turnstileSiteKey: str(wpFraud.turnstile_site_key),
    turnstileSecretKey: str(wpFraud.turnstile_secret_key),
    turnstileMode: ['off', 'managed', 'invisible'].includes(str(wpFraud.turnstile_mode))
      ? (str(wpFraud.turnstile_mode) as FraudSettings['turnstileMode'])
      : 'off',
    fpjsPublicApiKey: str(wpFraud.fpjs_public_api_key),
    fpjsRegion: str(wpFraud.fpjs_region, 'us'),
  };
  await saveFraudSettings(fraud);
  console.log('[migrate] settings updated');
}

async function main(): Promise<void> {
  console.log(`[migrate] source ${EXPORT_PATH}`);
  console.log(`[migrate] exported ${data.meta.exportedAt}`);
  if (FRESH) console.log('[migrate] fresh import enabled');
  await connectDatabase();
  try {
    await clearContent();
    await importUsers();
    await importCategories();
    await importTaxonomies();
    await importProducts();
    await importBlogCategories();
    await importPosts();
    await importPages();
    await importShowcases();
    await importOrders();
    await importReviews();
    await importFaqs();
    await importFraudEvents();
    await importCoupons();
    await importSettings();

    const counts = {
      users: await User.countDocuments(),
      categories: await Category.countDocuments(),
      blogCategories: await BlogCategory.countDocuments(),
      taxonomies: await Taxonomy.countDocuments(),
      products: await Product.countDocuments(),
      posts: await Post.countDocuments(),
      pages: await Page.countDocuments(),
      showcases: await Showcase.countDocuments(),
      orders: await Order.countDocuments(),
      reviews: await Review.countDocuments(),
      faqs: await Faq.countDocuments(),
      faqCategories: await FaqCategory.countDocuments(),
      fraudEvents: await FraudEvent.countDocuments(),
      coupons: await Coupon.countDocuments(),
    };
    console.log('[migrate] complete');
    console.log(JSON.stringify(counts, null, 2));
  } finally {
    await disconnectDatabase();
  }
}

main().catch(async (error) => {
  console.error('[migrate] failed', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
