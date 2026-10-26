import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env, isProd } from './config/env.js';
import { logger } from './lib/logger.js';
import { attachUser } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';
import { ensureUploadDirs, PUBLIC_DIR, readPublicFile } from './services/ticket.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_IMAGES_DIR = path.resolve(__dirname, '../public/images');
const WP_MEDIA_DIR = path.resolve(__dirname, '../public/media/wp');

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
              connectSrc: ["'self'", env.FRONTEND_URL, env.API_URL],
              frameSrc: ['https://challenges.cloudflare.com'],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: [env.FRONTEND_URL, env.ADMIN_URL, env.API_URL].filter(Boolean),
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime(), env: env.NODE_ENV } });
  });

  app.use('/api', apiLimiter, attachUser, apiRouter);

  /* WordPress media library */
  app.use('/media/wp', express.static(WP_MEDIA_DIR, { maxAge: isProd ? '365d' : 0, immutable: isProd }));

  /* Public media (product images) */
  app.get('/media/:filename', async (req, res, next) => {
    try {
      const { buffer, mime } = await readPublicFile(req.params.filename);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  /* Admin SPA (built by Vite into backend/public/admin) */
  const adminDist = path.resolve(__dirname, '..', 'public', 'admin');
  app.use('/admin', express.static(adminDist, { index: false, maxAge: isProd ? '1h' : 0 }));
  app.get(/^\/admin(\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(adminDist, 'index.html'));
  });

  /* Theme images */
  app.use('/images', express.static(PUBLIC_IMAGES_DIR, { maxAge: isProd ? '30d' : 0 }));

  /* Uploads (public media) */
  app.use('/uploads', express.static(PUBLIC_DIR, { maxAge: isProd ? '30d' : 0 }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export async function prepareRuntime() {
  await ensureUploadDirs();
}
