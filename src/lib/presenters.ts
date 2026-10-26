import type { CategoryDoc, ProductDoc } from '../models/index.js';
import { pageMeta, type PageMeta } from './http.js';

/**
 * Presentation helpers - shapes database documents into the exact JSON the
 * frontend consumes. Keeps controllers thin and the API contract stable.
 */

export function presentProduct(
  product: ProductDoc,
  options: { full?: boolean } = {},
): Record<string, unknown> {
  const base = {
    id: String(product._id),
    title: product.title,
    slug: product.slug,
    sku: product.sku,
    status: product.status,
    type: product.type,
    shortDescription: product.shortDescription,
    price: product.price,
    regularPrice: product.regularPrice,
    salePrice: product.salePrice,
    onSale: product.onSale,
    currency: product.currency,
    image: product.images?.[0]?.url ?? '',
    images: product.images ?? [],
    gallery: product.gallery ?? [],
    categoryIds: (product.categoryIds ?? []).map(String),
    tagIds: (product.tagIds ?? []).map(String),
    activityTypeIds: (product.activityTypeIds ?? []).map(String),
    rating: product.rating ?? { average: 0, count: 0, counts: {} },
    bookingCount: product.bookingCount,
    isFeatured: product.isFeatured,
    passportRequirement: product.passportRequirement,
    createdAt: product.createdAt,
  };

  if (!options.full) return base;

  return {
    ...base,
    description: product.description,
    content: product.content,
    keyPoints: product.keyPoints ?? {},
    importantInformation: product.importantInformation ?? {},
    liveTourGuide: product.liveTourGuide ?? {},
    highlightedText: product.highlightedText,
    highlightedQuantityText: product.highlightedQuantityText,
    trekksoftButtonLink: product.trekksoftButtonLink,
    productOptions: (product.productOptions ?? []).map((option, index) => ({
      index,
      name: option.name,
      details: option.details,
      type: option.type,
      capacity: option.capacity,
      active: option.active,
      startDate: option.startDate,
      endDate: option.endDate,
      repeat: option.repeat ?? [],
      startTime: option.startTime ?? [],
      duration: option.duration,
      cutoff: option.cutoff,
      languages: option.languages ?? [],
      lastDays: option.lastDays ?? { days: 0, percent: 0 },
      prices: (option.prices ?? []).map((price) => ({
        category: price.category,
        ageFrom: price.ageFrom,
        ageTo: price.ageTo,
        buyingPrice: price.buyingPrice,
        serviceCharge: price.serviceCharge,
        tax: price.tax,
        price: price.price,
        computedPrice: Math.round(
          (Number(price.buyingPrice ?? 0) +
            Number(price.serviceCharge ?? 0) +
            (Number(price.serviceCharge ?? 0) * Number(price.tax ?? 0)) / 100) *
            100,
        ) / 100,
      })),
    })),
    seo: product.seo ?? {},
  };
}

export function presentCategory(category: CategoryDoc): Record<string, unknown> {
  return {
    id: String(category._id),
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ? String(category.parentId) : null,
    description: category.description,
    categoryType: category.categoryType,
    categoryPageLink: category.categoryPageLink,
    topExperience: category.topExperience,
    topAttraction: category.topAttraction,
    image: category.image,
    icon: category.icon,
    productCount: category.productCount,
    order: category.order,
  };
}

export function presentOption(options: { total: number; page: number; limit: number }): PageMeta {
  return pageMeta(options.total, options.page, options.limit);
}
