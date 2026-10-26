import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  type Role,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../lib/tokens.js';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  return cookie ?? null;
}

/** Attaches `req.user` when a valid token is present. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
    } catch {
      /* expired or invalid -> treated as anonymous */
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('This action requires a higher privilege level.'));
    next();
  };
}

/** Issues fresh tokens when a valid refresh cookie is present. */
export function refreshSession(req: Request, res: Response, next: NextFunction) {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (!token) return next(unauthorized('No refresh token supplied'));
  try {
    const payload = verifyRefreshToken(token);
    const access = signAccessToken({ sub: payload.sub, email: payload.email, role: payload.role, name: payload.name });
    res.json({ success: true, data: { token: access } });
  } catch {
    next(unauthorized('Refresh token expired or invalid'));
  }
}

/** Same-origin guard for state-changing admin routes when cookies are used. */
export function requireSameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (env.NODE_ENV !== 'production') return next();
  const origin = req.headers.origin;
  if (origin && ![env.ADMIN_URL, env.FRONTEND_URL, env.API_URL].includes(origin)) {
    return next(forbidden('Cross-origin request blocked'));
  }
  next();
}
