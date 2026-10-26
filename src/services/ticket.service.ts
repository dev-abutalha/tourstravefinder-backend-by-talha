import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { forbidden, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Secure e-ticket storage.
 *
 * Files live OUTSIDE the public web root. They are only reachable through an
 * authenticated endpoint that verifies the requester owns the order (or is an
 * admin) and that the resolved path is still inside the secure directory.
 */

export const SECURE_DIR = path.resolve(process.cwd(), env.SECURE_UPLOAD_DIR);
export const PUBLIC_DIR = path.resolve(process.cwd(), env.UPLOAD_DIR);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.svg']);

export async function ensureUploadDirs(): Promise<void> {
  await fs.mkdir(SECURE_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
}

export function isAllowedTicketExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function sanitiseFilename(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const base = path
    .basename(original, ext)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || 'ticket'}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/** Persist an uploaded ticket inside the secure directory. */
export async function saveSecureTicket(
  buffer: Buffer,
  originalName: string,
  orderNumber: string,
): Promise<string> {
  await ensureUploadDirs();
  const filename = sanitiseFilename(originalName);
  const orderDir = path.join(SECURE_DIR, orderNumber.replace(/[^a-z0-9-_]/gi, ''));
  await fs.mkdir(orderDir, { recursive: true });

  const target = path.join(orderDir, filename);
  await fs.writeFile(target, buffer);
  logger.info({ orderNumber, filename }, 'Secure ticket stored');
  return target;
}

export async function removeSecureTicket(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(SECURE_DIR)) {
    throw forbidden('Refusing to delete a file outside the secure directory.');
  }
  await fs.rm(resolved, { force: true });
}

/**
 * Resolve a stored ticket to a readable buffer, guaranteeing the path stays
 * inside the secure directory (defends against traversal).
 */
export async function readSecureTicket(filePath: string): Promise<{ buffer: Buffer; filename: string; mime: string }> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(SECURE_DIR + path.sep) && resolved !== SECURE_DIR) {
    throw forbidden('Invalid ticket path.');
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw notFound('Ticket file not found.');
  }
  if (!stat.isFile()) throw notFound('Ticket file not found.');

  const buffer = await fs.readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const mime =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.png'
            ? 'image/png'
            : 'image/jpeg';

  return { buffer, filename: path.basename(resolved), mime };
}

/** Resolve a public media file (product images) inside the public upload dir. */
export async function readPublicFile(relativePath: string): Promise<{ buffer: Buffer; mime: string }> {
  const resolved = path.resolve(PUBLIC_DIR, relativePath.replace(/^[/\\]+/, ''));
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) throw forbidden('Invalid file path.');
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(resolved);
  } catch {
    throw notFound('File not found.');
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : 'application/octet-stream';
  return { buffer, mime };
}
