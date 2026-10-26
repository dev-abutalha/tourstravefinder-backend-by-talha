import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async handler so rejected promises reach the error middleware
 * instead of hanging the request (Express 5 does this natively, but we keep the
 * helper for explicit typing and for handlers that need the overload).
 */
export function asyncHandler<T extends RequestHandler>(fn: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export function pageMeta(total: number, page: number, limit: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { total, page, limit, totalPages, hasMore: page < totalPages };
}

/** Cursor-free pagination helper used by list endpoints. */
export function paginate(query: Record<string, unknown>, page = 1, limit = 20) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return {
    skip: (safePage - 1) * safeLimit,
    limit: safeLimit,
    page: safePage,
  };
}


/** Express 5 types params as `string | string[]`; routes here always use simple params. */
export function param(req: Request, key: string): string {
  const value = (req.params as Record<string, unknown>)[key];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}
