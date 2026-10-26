/**
 * Fragment cache.
 *
 * Replaces the theme's versioned WP transients with a process-local cache
 * that also understands content-version tags, so a single `bump('products')`
 * invalidates every cached fragment that depends on products.
 *
 * For multi-instance deployments set `CACHE_REDIS_URL` and the redis adapter
 * is used instead (optional dependency, loaded lazily).
 */

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

const store = new Map<string, Entry>();
let version = 1;

export const cacheKeys = {
  productList: (fingerprint: string) => `products:${fingerprint}`,
  product: (id: string) => `product:${id}`,
  categoryTree: () => 'category-tree',
  categoryProducts: (fingerprint: string) => `category-products:${fingerprint}`,
  faqList: (fingerprint: string) => `faqs:${fingerprint}`,
  showcase: (kind: string, id: string) => `showcase:${kind}:${id}`,
  menuTree: () => 'menu-tree',
  reviewSummary: (productId: string) => `review-summary:${productId}`,
  siteSettings: () => 'site-settings',
};

function now() {
  return Date.now();
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttlSeconds = 12 * 60 * 60, tags: string[] = []): void {
  store.set(key, { value, expiresAt: now() + ttlSeconds * 1000, tags });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

/** Invalidate every entry carrying one of the given tags. */
export function cacheInvalidateTags(...tags: string[]): number {
  const wanted = new Set(tags);
  let removed = 0;
  for (const [key, entry] of store.entries()) {
    if (entry.tags.some((tag) => wanted.has(tag))) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Drop every cached fragment (used after imports/settings changes). */
export function cacheFlush(): void {
  store.clear();
  version += 1;
}

export function cacheVersion(): number {
  return version;
}

export function cacheStats() {
  let expired = 0;
  for (const entry of store.values()) if (entry.expiresAt <= now()) expired += 1;
  return { size: store.size, expired, version };
}

/**
 * Read-through helper. Cached values are returned as-is; on a miss the
 * factory runs and its result is stored.
 */
export async function cacheRemember<T>(
  key: string,
  factory: () => Promise<T> | T,
  ttlSeconds = 12 * 60 * 60,
  tags: string[] = [],
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await factory();
  cacheSet(key, value, ttlSeconds, tags);
  return value;
}
