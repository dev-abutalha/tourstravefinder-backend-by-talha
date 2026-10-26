/** Domain error with an HTTP status attached. Thrown anywhere, formatted centrally. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(message: string, status = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(msg, 400, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Authentication required') => new AppError(msg, 401, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have permission to do that') => new AppError(msg, 403, 'FORBIDDEN');
export const notFound = (msg = 'Not found') => new AppError(msg, 404, 'NOT_FOUND');
export const conflict = (msg: string) => new AppError(msg, 409, 'CONFLICT');
export const tooMany = (msg = 'Too many requests') => new AppError(msg, 429, 'RATE_LIMITED');
export const unprocessable = (msg: string, details?: unknown) => new AppError(msg, 422, 'UNPROCESSABLE', details);
