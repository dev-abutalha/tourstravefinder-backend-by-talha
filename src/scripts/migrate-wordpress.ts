/**
 * WordPress -> MongoDB importer.
 *
 * Pulls content from the existing WordPress site over its REST API. No MySQL
 * access is required: WordPress core endpoints cover posts/pages, the
 * WooCommerce endpoints cover products/terms/orders, and the theme's custom
 * post types are read if they are exposed under `/wp-json/wp/v2`.
 *
 * Required environment:
 *   WP_BASE_URL            e.g. http://tours-travel-finder.local
 *   WP_CONSUMER_KEY        WooCommerce REST consumer key  (products/orders)
 *   WP_CONSUMER_SECRET     WooCommerce REST consumer secret
 * Optional:
 *   WP_USER / WP_APP_PASSWORD   application password for core endpoints
 *                               (only needed when the site is private)
 *
 * Usage:
 *   npx tsx src/scripts/migrate-wordpress.ts --dry
 *   npx tsx src/scripts/migrate-wordpress.ts
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import {
  Category,
  Faq,
  FaqCategory,
  Page,
  Post,
  Product,
  Showcase,
  Taxonomy,
  type ProductOptionInput,
} from '../models/index.js';

const DRY = process.argv.includes('--dry');
const BASE = (process.env.WP_BASE_URL ?? '').replace(/\/$/, '');
const CK = process.env.WP_CONSUMER_KEY ?? '';
const CS = process.env.WP_CONSUMER_SECRET ?? '';
const WP_USER = process.env.WP_USER ?? '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD ?? '';

if (!BASE) {
  console.error('WP_BASE_URL is required, e.g. WP_BASE_URL=http://tours-travel-finder.local');
  process.exit(1);
}

function headers(): Record<string, string> {
  if (!WP_USER || !WP_APP_PASSWORD) return {};
  return { Authorization: `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64')}` };
}

function withAuth(url: URL): URL {
  if (CK && CS) {
    url.searchParams.set('consumer_key', CK);
    url.searchParams.set('consumer_secret', CS);
  }
  return url;
}

async function fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = withAuth(new URL(`${BASE}${path}`));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url.pathname}${url.search}`);
  return (await response.json()) as T;
}

async function fetchAll<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await fetchJson<T[]>(path, { per_page: 100, page, ...params });
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const log = (message: string) => console.log(`[migrate] ${message}`);

/* ------------------------------------------------------------------ */
/* Core types (only the fields this importer needs)                    */
/* ------------------------------------------------------------------ */

interface WPPost {
  id: number;
  slug: string;
  status: string;
  date: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
  author?: number;
  featured_media?: number;
  _embedded?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

interface WCTerm {
  id: number;
  name: string;
  slug: string;
  parent: number;
  description: string;
  image?: { src?: string } | null;
  count?: number;
}

interface WCProduct {
  id: number;
  name: string;
  slug: string;
  status: string;
  type: string;
  description: string;
  short_description: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  sku: string;
  images: { src: string; alt?: string }[];
  categories: { id: number; name: string; slug: string }[];
  tags: { id: number; name: string; slug: string }[];
  meta_data: { key: string; value: unknown }[];
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeTitle(value: string): string {
  return value
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function metaMap(product: WCProduct): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of product.meta_data ?? []) map[row.key] = row.value;
  return map;
}

function toNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapOptions(meta: Record<string, unknown>): ProductOptionInput[] {
  const raw = meta._ttf_product_options;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? safeJson(raw) : [];
  if (!Array.isArray(list)) return [];

  return list.map((entry) => {
    const option = (entry ?? {}) as Record<string, unknown>;
    const lastDays = (option.lastdays ?? option.last_days ?? {}) as Record<string, unknown>;
    const prices = Array.isArray(option.prices) ? option.prices : [];
    return {
      name: String(option.name ?? 'Standard'),
      details: String(option.details ?? ''),
      type: String(option.type ?? 'Single Day'),
      capacity: toNumber(option.capacity),
      active: Boolean(toNumber(option.active)),
      startDate: String(option.startdate ?? option.start_date ?? ''),
      endDate: String(option.enddate ?? option.end_date ?? ''),
      repeat: Array.isArray(option.repeat) ? option.repeat.map(String) : undefined,
      startTime: Array.isArray(option.starttime) ? option.starttime.map(String) : Array.isArray(option.start_time) ? option.start_time.map(String) : undefined,
      duration: String(option.duration ?? ''),
      cutoff: toNumber(option.cutoff),
      languages: Array.isArray(option.languages) ? option.languages.map(String) : [],
      lastDays: { days: toNumber(lastDays.days), percent: toNumber(lastDays.percent) },
      prices: (prices as Record<string, unknown>[]).map((price) => ({
        category: String(price.category ?? 'Adult'),
        ageFrom: toNumber(price.age_from ?? price.ageFrom),
        ageTo: toNumber(price.age_to ?? price.ageTo),
        buyingPrice: toNumber(price.buying_price ?? price.buyingPrice),
        serviceCharge: toNumber(price.service_charge ?? price.serviceCharge),
        tax: toNumber(price.tax),
        price: toNumber(price.price),
      })),
    };
  });
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

async function importCategories(): Promise<Record<string, string>> {
  const terms = await fetchAll<WCTerm>('/wp-json/wc/v3/products/categories');
  const idToLocal: Record<string, string> = {};

  const sorted = [...terms].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));

  for (const term of sorted) {
    if (DRY) {
      log(`would upsert category ${term.name}`);
      continue;
    }
    const doc = await Category.findOneAndUpdate(
      { slug: term.slug },
      {
        $set: {
          name: term.name,
          slug: term.slug,
          description: stripTags(term.description ?? ''),
          parentId: term.parent ? idToLocal[String(term.parent)] ?? null : null,
          image: term.image?.src ?? '',
          productCount: term.count ?? 0,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    idToLocal[String(term.id)] = String(doc._id);
  }

  log(`${terms.length} product categories`);
  return idToLocal;
}

async function importTaxonomies(): Promise<{ tags: Record<string, string>; activity: Record<string, string> }> {
  const tags: Record<string, string> = {};
  const activity: Record<string, string> = {};

  try {
    const terms = await fetchAll<WCTerm>('/wp-json/wc/v3/products/tags');
    for (const term of terms) {
      if (DRY) {
        log(`would upsert tag ${term.name}`);
        continue;
      }
      const doc = await Taxonomy.findOneAndUpdate(
        { slug: `tag-${term.slug}` },
        { $set: { name: term.name, slug: `tag-${term.slug}`, kind: 'product_tag' } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      tags[String(term.id)] = String(doc._id);
    }
    log(`${terms.length} product tags`);
  } catch (error) {
    log(`product tags skipped: ${(error as Error).message}`);
  }

  try {
    const terms = await fetchAll<WCTerm>('/wp-json/wp/v2/activity_type');
    for (const term of terms) {
      if (DRY) {
        log(`would upsert activity type ${term.name}`);
        continue;
      }
      const doc = await Taxonomy.findOneAndUpdate(
        { slug: `activity-${term.slug}` },
        { $set: { name: term.name, slug: `activity-${term.slug}`, kind: 'activity_type' } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      activity[String(term.id)] = String(doc._id);
    }
    log(`${terms.length} activity types`);
  } catch {
    log('activity types endpoint not exposed - skipped');
  }

  return { tags, activity };
}

async function importProducts(categories: Record<string, string>, tags: Record<string, string>, activity: Record<string, string>) {
  const products = await fetchAll<WCProduct>('/wp-json/wc/v3/products', { status: 'any' });
  let count = 0;

  for (const product of products) {
    if (DRY) {
      log(`would import product ${product.name}`);
      continue;
    }
    const meta = metaMap(product);
    const options = mapOptions(meta);
    const categoryIds = product.categories.map((c) => categories[String(c.id)]).filter(Boolean);
    const tagIds = product.tags.map((t) => tags[String(t.id)]).filter(Boolean);

    await Product.findOneAndUpdate(
      { slug: product.slug },
      {
        $set: {
          title: decodeTitle(product.name),
          slug: product.slug,
          sku: product.sku,
          status: product.status === 'publish' ? 'publish' : 'draft',
          type: product.type === 'variable' ? 'variable' : 'simple',
          shortDescription: stripTags(product.short_description ?? ''),
          description: product.description ?? '',
          content: product.description ?? '',
          price: toNumber(product.price),
          regularPrice: toNumber(product.regular_price),
          salePrice: toNumber(product.sale_price),
          onSale: Boolean(product.on_sale),
          images: (product.images ?? []).map((image) => ({ url: image.src, alt: image.alt ?? '' })),
          gallery: (product.images ?? []).slice(1).map((image) => image.src),
          categoryIds,
          tagIds,
          activityTypeIds: [],
          productOptions: options,
          unavailableSlots: (meta._ttf_unavailable_slots as Record<string, unknown>) ?? {},
          slotQuantities: (meta._ttf_slot_quantities as Record<string, unknown>) ?? {},
          passportRequirement: (meta._ttf_passport_requirement as string) ?? 'none',
          keyPoints: {
            cancellationPolicy: String(meta.key_points_cancellation_policy ?? ''),
            duration: String(meta.key_points_duration ?? ''),
            lastMinuteAvailability: String(meta.key_points_last_minute_availability ?? ''),
            wheelchairAccessible: String(meta.key_points_wheelchair_accessible ?? ''),
            skipTheLine: String(meta.key_points_skip_the_line ?? ''),
            guideType: String(meta.key_points_guide_type ?? ''),
          },
          importantInformation: {
            title: String(meta.important_information_title ?? ''),
            content: String(meta.important_information_content ?? ''),
          },
          liveTourGuide: {
            title: String(meta.live_tour_guide_title ?? ''),
            content: String(meta.live_tour_guide_content ?? ''),
          },
          trekksoftButtonLink: String(meta.trekksoft_button_link ?? ''),
          highlightedText: String(meta.highlighted_text ?? ''),
          highlightedQuantityText: String(meta.highlighted_quantity_text ?? ''),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    count += 1;
  }

  log(`${count} products`);
  void tags;
  void activity;
}

async function importCoreContent() {
  const posts = await fetchAll<WPPost>('/wp-json/wp/v2/posts', { status: 'any' });
  for (const post of posts) {
    if (DRY) {
      log(`would import post ${post.slug}`);
      continue;
    }
    await Post.findOneAndUpdate(
      { slug: post.slug },
      {
        $set: {
          title: decodeTitle(post.title.rendered),
          slug: post.slug,
          status: post.status === 'publish' ? 'publish' : 'draft',
          excerpt: stripTags(post.excerpt.rendered ?? ''),
          content: post.content.rendered ?? '',
          contentHtml: post.content.rendered ?? '',
          authorName: '',
          readingMinutes: Math.max(1, Math.round(stripTags(post.content.rendered ?? '').split(' ').length / 200)),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  log(`${posts.length} posts`);

  const pages = await fetchAll<WPPost>('/wp-json/wp/v2/pages', { status: 'any' });
  const templateMap: Record<string, string> = {
    'page-home.php': 'home',
    'page-faq.php': 'faq',
    'page-order-status.php': 'order-status',
    'page-destination.php': 'destination',
    'page-attraction.php': 'attraction',
    'page-guided-tours.php': 'guided-tours',
  };

  for (const page of pages) {
    if (DRY) {
      log(`would import page ${page.slug}`);
      continue;
    }
    const template = String((page.meta as Record<string, unknown> | undefined)?._wp_page_template ?? 'default');
    await Page.findOneAndUpdate(
      { slug: page.slug },
      {
        $set: {
          title: decodeTitle(page.title.rendered),
          slug: page.slug,
          status: page.status === 'publish' ? 'publish' : 'draft',
          template: templateMap[template] ?? 'default',
          content: page.content.rendered ?? '',
          excerpt: stripTags(page.excerpt.rendered ?? ''),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  log(`${pages.length} pages`);
}

async function importFaqs() {
  try {
    const terms = await fetchAll<WCTerm>('/wp-json/wp/v2/faq_category');
    const idToLocal: Record<string, string> = {};
    for (const term of terms) {
      if (DRY) continue;
      const doc = await FaqCategory.findOneAndUpdate(
        { slug: term.slug },
        { $set: { name: term.name, slug: term.slug, description: stripTags(term.description ?? '') } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      idToLocal[String(term.id)] = String(doc._id);
    }

    const faqs = await fetchAll<WPPost>('/wp-json/wp/v2/faq', { status: 'any' });
    for (const faq of faqs) {
      if (DRY) continue;
      const termIds = (faq as unknown as { faq_category?: number[] }).faq_category ?? [];
      await Faq.findOneAndUpdate(
        { slug: faq.slug },
        {
          $set: {
            title: decodeTitle(faq.title.rendered),
            slug: faq.slug,
            status: faq.status === 'publish' ? 'publish' : 'draft',
            content: faq.content.rendered ?? '',
            excerpt: stripTags(faq.excerpt.rendered ?? ''),
            categoryIds: termIds.map((id) => idToLocal[String(id)]).filter(Boolean),
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
    }
    log(`${faqs.length} faqs`);
  } catch {
    log('FAQ endpoints not exposed - skipped');
  }
}

async function importShowcases() {
  const map: { endpoint: string; kind: 'destination' | 'attraction' }[] = [
    { endpoint: '/wp-json/wp/v2/top_destinations', kind: 'destination' },
    { endpoint: '/wp-json/wp/v2/top_attractions', kind: 'attraction' },
  ];

  for (const entry of map) {
    try {
      const posts = await fetchAll<WPPost>(entry.endpoint, { status: 'any' });
      for (const post of posts) {
        if (DRY) continue;
        const meta = (post.meta ?? {}) as Record<string, unknown>;
        const rawItems = meta.items ?? meta.destinations ?? meta.attractions;
        const items = Array.isArray(rawItems) ? rawItems : [];
        await Showcase.findOneAndUpdate(
          { kind: entry.kind, slug: post.slug },
          {
            $set: {
              kind: entry.kind,
              title: decodeTitle(post.title.rendered),
              slug: post.slug,
              status: post.status === 'publish' ? 'publish' : 'draft',
              items: (items as Record<string, unknown>[]).map((item, index) => ({
                title: String(item.title ?? ''),
                subtitle: String(item.subtitle ?? ''),
                description: String(item.description ?? ''),
                image: String(item.image ?? ''),
                link: String(item.link ?? ''),
                pageTitle: String(item.page_title ?? item.title ?? ''),
                order: index,
              })),
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );
      }
      log(`${posts.length} ${entry.kind} showcases`);
    } catch {
      log(`${entry.kind} endpoint not exposed - skipped`);
    }
  }
}

async function main() {
  if (DRY) log('dry run - no database writes');
  if (!DRY) await connectDatabase();

  const categories = await importCategories();
  const { tags, activity } = await importTaxonomies();
  await importProducts(categories, tags, activity);
  await importCoreContent();
  await importFaqs();
  await importShowcases();

  log('done');
  if (!DRY) await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('[migrate] failed', error);
  if (!DRY) await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
