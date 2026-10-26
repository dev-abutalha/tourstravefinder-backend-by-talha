import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'customer' | 'manager' | 'admin';
        name?: string;
      };
      requestId?: string;
    }
  }
}

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
  });
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The submitted data is invalid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.originalUrl }, 'Application error');
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof Error && err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
    });
  }

  if (err instanceof Error && 'code' in err && (err as { code?: number }).code === 11000) {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE', message: 'A record with that identifier already exists.' },
    });
  }

  logger.error({ err, path: req.originalUrl }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' },
  });
};

/** Parses `req[source]` with a Zod schema and REPLACES it with the parsed value. */
export function validate<T extends ZodType>(schema: T, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(result.error);
    }
    // Express 5 exposes `req.query` as a getter-only property, so assigning to
    // it throws. Define an own property instead; this shadows the prototype
    // getter and keeps the parsed value available to downstream handlers.
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
