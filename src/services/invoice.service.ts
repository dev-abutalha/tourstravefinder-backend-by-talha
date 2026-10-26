import PDFDocument from 'pdfkit';
import type { OrderDoc } from '../models/index.js';
import { getSiteSettings } from './settings.service.js';

/**
 * PDF invoice generation.
 *
 * Replaces the theme's dompdf implementation with PDFKit, which streams
 * directly and needs no headless browser.
 */

const BRAND = '#1d1e27';
const MUTED = '#6b6f7d';
const LINE = '#e3e6ec';

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(value ?? 0);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'invoice';
}

export async function renderInvoice(order: OrderDoc): Promise<{ filename: string; buffer: Buffer }> {
  const settings = await getSiteSettings();
  const currency = order.currency || settings.currency || 'EUR';

  const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
    Title: `Invoice ${order.orderNumber}`,
    Author: settings.siteName,
  } });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  /* Header -------------------------------------------------- */
  doc.fillColor(BRAND).fontSize(24).font('Helvetica-Bold').text(settings.siteName, 50, 50);
  doc.fontSize(10).font('Helvetica').fillColor(MUTED);
  doc.text(settings.siteUrl ?? '', 50, 80);
  doc.text(settings.supportEmail ?? '', 50, 94);

  doc.fontSize(22).font('Helvetica-Bold').fillColor(BRAND).text('INVOICE', 0, 50, { align: 'right', width: 495 });
  doc.fontSize(11).font('Helvetica').fillColor(MUTED);
  doc.text(`#${order.orderNumber}`, 0, 78, { align: 'right', width: 495 });
  doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-GB')}`, 0, 94, { align: 'right', width: 495 });
  doc.text(`Status: ${order.status}`, 0, 110, { align: 'right', width: 495 });

  /* Parties ------------------------------------------------ */
  let y = 140;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).stroke();
  y += 20;

  doc.fontSize(10).font('Helvetica-Bold').fillColor(MUTED).text('BILLED TO', 50, y);
  doc.text('PAYMENT METHOD', 320, y);
  y += 16;

  doc.fontSize(11).font('Helvetica').fillColor(BRAND);
  const billing = order.billing ?? {};
  const billTo = [billing.firstName && billing.lastName ? `${billing.firstName} ${billing.lastName}` : order.customerEmail]
    .filter(Boolean)
    .join(' ');
  doc.text(billTo, 50, y, { width: 240 });
  doc.text(order.customerEmail ?? '', 50, doc.y, { width: 240 });
  if (billing.phone) doc.text(billing.phone, 50, doc.y, { width: 240 });
  if (billing.city || billing.country) {
    doc.text([billing.city, billing.country].filter(Boolean).join(', '), 50, doc.y, { width: 240 });
  }

  doc.fontSize(11).font('Helvetica').fillColor(BRAND);
  doc.text((order.paymentMethod ?? 'cod').toUpperCase(), 320, y, { width: 225 });
  doc.text(order.transactionId ? `Ref: ${order.transactionId}` : 'Payment pending', 320, doc.y, { width: 225 });

  y = Math.max(doc.y, y + 60) + 10;

  /* Items -------------------------------------------------- */
  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).stroke();
  y += 12;

  doc.fontSize(9).font('Helvetica-Bold').fillColor(MUTED);
  doc.text('ITEM', 50, y);
  doc.text('DATE / TIME', 280, y);
  doc.text('QTY', 395, y);
  doc.text('TOTAL', 465, y, { width: 80, align: 'right' });
  y += 16;

  doc.fontSize(10).font('Helvetica').fillColor(BRAND);
  for (const item of order.items ?? []) {
    const rowTop = y;
    doc.text(item.productTitle ?? 'Item', 50, y, { width: 220 });
    if (item.optionName) {
      doc.fontSize(9).fillColor(MUTED).text(item.optionName, 50, doc.y, { width: 220 });
    }
    doc.fontSize(9).fillColor(MUTED).text(
      [item.date, item.time].filter(Boolean).join(' · '),
      280,
      rowTop,
      { width: 105 },
    );
    doc.text(String(item.travelerCount ?? 1), 395, rowTop);
    doc.fontSize(10).fillColor(BRAND).text(money(item.total ?? 0, currency), 465, rowTop, { width: 80, align: 'right' });

    y = Math.max(doc.y, rowTop + 14) + 8;
    doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor(LINE).stroke();
    y += 6;
  }

  /* Totals ------------------------------------------------- */
  y += 6;
  const totals: [string, number][] = [
    ['Subtotal', order.subtotal ?? 0],
    ...(order.discountTotal ? ([['Discount', -(order.discountTotal ?? 0)]] as [string, number][]) : []),
    ...(order.feeTotal ? ([['Extras', order.feeTotal ?? 0]] as [string, number][]) : []),
    ...(order.taxTotal ? ([['Tax included', order.taxTotal ?? 0]] as [string, number][]) : []),
  ];

  for (const [label, value] of totals) {
    doc.fontSize(10).font('Helvetica').fillColor(MUTED);
    doc.text(label, 330, y, { width: 120, align: 'right' });
    doc.text(money(value, currency), 455, y, { width: 90, align: 'right' });
    y += 16;
  }

  doc.moveTo(330, y).lineTo(545, y).strokeColor(LINE).stroke();
  y += 10;
  doc.fontSize(13).font('Helvetica-Bold').fillColor(BRAND);
  doc.text('Total', 330, y, { width: 120, align: 'right' });
  doc.text(money(order.total ?? 0, currency), 455, y, { width: 90, align: 'right' });

  /* Booking meta ------------------------------------------- */
  y += 40;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(MUTED).text('BOOKING DETAILS', 50, y);
  y += 14;
  doc.fontSize(10).font('Helvetica').fillColor(BRAND);
  const meta: [string, string][] = [
    ['Travellers', String(order.travelerCount ?? order.items?.[0]?.travelerCount ?? 1)],
    ...(order.pickupOption ? ([['Pickup', order.pickupOption]] as [string, string][]) : []),
    ...(order.departureOption ? ([['Departure', order.departureOption]] as [string, string][]) : []),
    ...(order.extras?.length
      ? ([['Extras', order.extras.map((e) => e.label).join(', ')]] as [string, string][])
      : []),
  ];
  for (const [label, value] of meta) {
    doc.text(`${label}: ${value}`, 50, y, { width: 495 });
    y += 14;
  }

  /* Passengers --------------------------------------------- */
  if (order.passengers?.length) {
    y += 12;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(MUTED).text('TRAVELLERS', 50, y);
    y += 14;
    doc.fontSize(10).font('Helvetica').fillColor(BRAND);
    for (const p of order.passengers) {
      doc.text(`${p.firstName} ${p.lastName}${p.passport ? ` · Passport ${p.passport}` : ''}`, 50, y, {
        width: 495,
      });
      y += 14;
    }
  }

  /* Footer ------------------------------------------------- */
  const footerY = 760;
  doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor(LINE).stroke();
  doc.fontSize(9).font('Helvetica').fillColor(MUTED);
  doc.text(
    `${settings.siteName} · ${settings.supportEmail ?? ''} · ${settings.siteUrl ?? ''}`,
    50,
    footerY + 12,
    { width: 495, align: 'center' },
  );

  doc.end();
  const buffer = await done;
  return { filename: `Invoice-${safeFileName(order.orderNumber)}.pdf`, buffer };
}
