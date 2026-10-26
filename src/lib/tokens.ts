import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env } from '../config/env.js';

export type Role = 'customer' | 'manager' | 'admin';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  name?: string;
}

export const ACCESS_COOKIE = 'ttf_token';
export const REFRESH_COOKIE = 'ttf_refresh';

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, typ: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const base = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    domain: env.COOKIE_DOMAIN,
  };
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookies(res: Response) {
  const base = { httpOnly: true, path: '/', domain: env.COOKIE_DOMAIN };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}
