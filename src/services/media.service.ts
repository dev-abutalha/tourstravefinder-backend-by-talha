import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PUBLIC_DIR } from './ticket.service.js';

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.avif', '.pdf']);

function sanitise(original: string): string {
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED.has(ext)) throw new Error('Unsupported file type.');
  const base = path
    .basename(original, ext)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || 'file'}-${crypto.randomBytes(5).toString('hex')}${ext}`;
}

export async function writePublicFile(buffer: Buffer, originalName: string): Promise<string> {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const filename = sanitise(originalName);
  await fs.writeFile(path.join(PUBLIC_DIR, filename), buffer);
  return filename;
}

export async function removePublicFile(filename: string): Promise<void> {
  const resolved = path.resolve(PUBLIC_DIR, path.basename(filename));
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return;
  await fs.rm(resolved, { force: true });
}

export function publicMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'image/jpeg';
  }
}
