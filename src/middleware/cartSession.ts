import type { NextFunction, Request, Response } from 'express';
import { CART_COOKIE, getOrCreateCart, newSessionId } from '../services/cart.service.js';
import type { CartDoc } from '../models/index.js';
import { env } from '../config/env.js';

/**
 * Resolves (or creates) the server-side cart for the current visitor.
 * The session id lives in a long-lived cookie so a guest can resume their
 * reservation across pages.
 */
export async function cartSession(req: Request, res: Response, next: NextFunction) {
  try {
    let sessionId = (req.cookies as Record<string, string> | undefined)?.[CART_COOKIE];

    if (!sessionId || !/^[a-f0-9]{32,64}$/.test(sessionId)) {
      sessionId = newSessionId();
      res.cookie(CART_COOKIE, sessionId, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        domain: env.COOKIE_DOMAIN,
      });
    }

    const cart = (await getOrCreateCart(sessionId, req.user?.id)) as CartDoc;
    res.locals.cart = cart;
    next();
  } catch (err) {
    next(err);
  }
}

export function currentCart(res: Response): CartDoc {
  return res.locals.cart as CartDoc;
}
