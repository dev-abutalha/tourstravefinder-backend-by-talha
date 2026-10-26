import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getSiteSettings } from '../../services/settings.service.js';

/**
 * Transactional email delivery.
 *
 * Ported from the theme's WooCommerce email templates plus the bespoke
 * cancellation / review / ticket emails. Every template shares one layout so
 * branding stays consistent.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    auth: env.MAIL_USER ? { user: env.MAIL_USER, pass: env.MAIL_PASSWORD } : undefined,
  });
  return transporter;
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; path?: string; content?: Buffer | string; contentType?: string }[];
  replyTo?: string;
}

/** Development default is intentionally inert; enable real SMTP via env. */
function mailConfigured(): boolean {
  return Boolean(env.MAIL_HOST) && !['smtp.example.com', 'localhost'].includes(env.MAIL_HOST);
}

export async function sendMail(options: SendMailOptions): Promise<boolean> {
  if (!mailConfigured()) {
    logger.debug({ to: options.to, subject: options.subject }, 'Email suppressed (SMTP not configured)');
    return true;
  }
  const settings = await getSiteSettings();
  try {
    await getTransporter().sendMail({
      from: {
        name: settings.mailFromName || env.MAIL_FROM_NAME,
        address: settings.mailFromAddress || env.MAIL_FROM_ADDRESS,
      },
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
      replyTo: options.replyTo,
    });
    logger.info({ to: options.to, subject: options.subject }, 'Email sent');
    return true;
  } catch (err) {
    logger.error({ err, to: options.to, subject: options.subject }, 'Email delivery failed');
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Layout                                                             */
/* ------------------------------------------------------------------ */

const BRAND = '#1d1e27';
const ACCENT = '#2271b1';

export function emailLayout(options: {
  title: string;
  preheader?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}): string {
  const { title, body, ctaLabel, ctaUrl, footerNote } = options;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader ?? title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:800;">${escapeHtml(title)}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 24px;font-size:15px;line-height:1.65;color:#3a3c47;">
          ${body}
          ${
            ctaLabel && ctaUrl
              ? `<p style="margin:26px 0 0;"><a href="${ctaUrl}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-weight:700;font-size:14px;">${escapeHtml(ctaLabel)}</a></p>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid #eceef2;font-size:12px;color:#7b7f8c;line-height:1.6;">
          ${escapeHtml(footerNote ?? 'You are receiving this email because you made a booking with us.')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const money = (value: number, currency = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(value ?? 0);

/* ------------------------------------------------------------------ */
/* Order emails                                                       */
/* ------------------------------------------------------------------ */

export interface OrderEmailPayload {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: { title?: string | null; optionName?: string | null; date?: string | null; time?: string | null; travelers?: number | null; total?: number | null }[];
  total: number;
  currency?: string;
  trackingUrl?: string;
}

function orderSummaryTable(payload: OrderEmailPayload): string {
  const rows = payload.items
    .map(
      (item) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #eceef2;">
          <strong>${escapeHtml(item.title)}</strong>
          ${item.optionName ? `<div style="font-size:13px;color:#6b6f7d;">${escapeHtml(item.optionName)}</div>` : ''}
          <div style="font-size:13px;color:#6b6f7d;">${escapeHtml(item.date)}${item.time ? ` &middot; ${escapeHtml(item.time)}` : ''} &middot; ${item.travelers} traveller(s)</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eceef2;text-align:right;font-weight:700;white-space:nowrap;">${money(item.total ?? 0, payload.currency)}</td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;font-size:14px;">
    ${rows}
    <tr><td style="padding:14px 0;font-weight:800;">Total</td><td style="padding:14px 0;text-align:right;font-weight:800;">${money(payload.total, payload.currency)}</td></tr>
  </table>`;
}

export async function emailOrderReceived(payload: OrderEmailPayload) {
  const body = `
    <p>Hi ${escapeHtml(payload.customerName)},</p>
    <p>We have received your booking request and are confirming your ticket with our partner.</p>
    ${orderSummaryTable(payload)}
    <p>Keep this email handy - your tickets and invoice will be sent to this address.</p>`;
  return sendMail({
    to: payload.customerEmail,
    subject: 'Your booking has been received',
    html: emailLayout({ title: 'Your booking has been received', body }),
  });
}

export async function emailOrderProcessing(payload: OrderEmailPayload) {
  const body = `
    <p>Hi ${escapeHtml(payload.customerName)},</p>
    <p>Your booking <strong>#${escapeHtml(payload.orderNumber)}</strong> is currently being processed by our team.</p>
    ${orderSummaryTable(payload)}`;
  return sendMail({
    to: payload.customerEmail,
    subject: `Update: Your booking #${payload.orderNumber} is under processing`,
    html: emailLayout({ title: 'Your booking is being processed', body }),
  });
}

export async function emailOrderConfirmed(payload: OrderEmailPayload) {
  const body = `
    <p>Hi ${escapeHtml(payload.customerName)},</p>
    <p>Great news - your booking <strong>#${escapeHtml(payload.orderNumber)}</strong> has been successfully confirmed.</p>
    ${orderSummaryTable(payload)}
    <p>Your e-tickets are attached in a separate email.</p>`;
  return sendMail({
    to: payload.customerEmail,
    subject: `Booking confirmed - #${payload.orderNumber}`,
    html: emailLayout({
      title: 'Your booking is confirmed',
      body,
      ctaLabel: 'Track your booking',
      ctaUrl: payload.trackingUrl,
    }),
  });
}

export async function emailAdminNewOrder(payload: OrderEmailPayload) {
  const body = `
    <p>A new booking has been placed.</p>
    ${orderSummaryTable(payload)}`;
  return sendMail({
    to: process.env.ADMIN_EMAIL || 'admin@example.com',
    subject: `New booking - #${payload.orderNumber}`,
    html: emailLayout({ title: `New booking #${payload.orderNumber}`, body }),
  });
}

export async function emailOrderCancelled(payload: OrderEmailPayload) {
  const body = `
    <p>Hi ${escapeHtml(payload.customerName)},</p>
    <p>Your booking <strong>#${escapeHtml(payload.orderNumber)}</strong> has been cancelled and a full refund has been issued where applicable.</p>`;
  return sendMail({
    to: payload.customerEmail,
    subject: `Booking cancelled - #${payload.orderNumber}`,
    html: emailLayout({ title: 'Your booking was cancelled', body }),
  });
}

export async function emailOrderFailed(payload: OrderEmailPayload) {
  const body = `
    <p>Hi ${escapeHtml(payload.customerName)},</p>
    <p>We were unable to process your booking <strong>#${escapeHtml(payload.orderNumber)}</strong>. Any authorised payment has been released.</p>`;
  return sendMail({
    to: payload.customerEmail,
    subject: `Booking failed - #${payload.orderNumber}`,
    html: emailLayout({ title: 'We could not confirm your booking', body }),
  });
}

/* ------------------------------------------------------------------ */
/* Cancellation workflow                                               */
/* ------------------------------------------------------------------ */

export async function emailCancellationRequested(orderNumber: string, customerName: string, reason: string) {
  const body = `
    <p><strong>${escapeHtml(customerName)}</strong> has requested cancellation of booking <strong>#${escapeHtml(orderNumber)}</strong>.</p>
    <p><strong>Reason:</strong> ${escapeHtml(reason || 'Not provided')}</p>
    <p>Review and resolve this request in the admin panel.</p>`;
  return sendMail({
    to: process.env.ADMIN_EMAIL || 'admin@example.com',
    subject: `Cancellation Request - Order #${orderNumber}`,
    html: emailLayout({ title: `Cancellation request - #${orderNumber}`, body }),
  });
}

export async function emailCancellationAccepted(
  orderNumber: string,
  customerName: string,
  customerEmail: string,
) {
  const body = `
    <p>Hi ${escapeHtml(customerName)},</p>
    <p>Your cancellation request for booking <strong>#${escapeHtml(orderNumber)}</strong> has been accepted. Any refund will be returned to your original payment method within 5-10 business days.</p>`;
  return sendMail({
    to: customerEmail,
    subject: `Order Cancelled - #${orderNumber}`,
    html: emailLayout({ title: 'Your cancellation was accepted', body }),
  });
}

export async function emailCancellationRejected(
  orderNumber: string,
  customerName: string,
  customerEmail: string,
  reason: string,
) {
  const body = `
    <p>Hi ${escapeHtml(customerName)},</p>
    <p>We are sorry - your cancellation request for booking <strong>#${escapeHtml(orderNumber)}</strong> could not be approved.</p>
    <p><strong>Reason:</strong> ${escapeHtml(reason || 'Not provided')}</p>`;
  return sendMail({
    to: customerEmail,
    subject: `Cancellation Request Update - #${orderNumber}`,
    html: emailLayout({ title: 'Cancellation request update', body }),
  });
}

/* ------------------------------------------------------------------ */
/* Reviews & tickets                                                  */
/* ------------------------------------------------------------------ */

export async function emailReviewRequest(
  orderNumber: string,
  customerName: string,
  customerEmail: string,
  productTitle: string,
  reviewUrl: string,
) {
  const body = `
    <p>Hi ${escapeHtml(customerName)},</p>
    <p>Thank you for booking <strong>${escapeHtml(productTitle)}</strong> with us. How was your experience?</p>
    <p>Your feedback helps other travellers choose with confidence.</p>`;
  return sendMail({
    to: customerEmail,
    subject: 'Review your tour',
    html: emailLayout({ title: 'How was your tour?', body, ctaLabel: 'Leave a review', ctaUrl: reviewUrl }),
  });
}

export async function emailTickets(orderNumber: string, customerName: string, customerEmail: string, ticketCount: number) {
  const body = `
    <p>Hi ${escapeHtml(customerName)},</p>
    <p>Your e-ticket${ticketCount === 1 ? '' : 's'} for booking <strong>#${escapeHtml(orderNumber)}</strong> ${ticketCount === 1 ? 'is' : 'are'} attached to this email.</p>
    <p>Please carry the ticket with you, either on your phone or printed out.</p>`;
  return sendMail({
    to: customerEmail,
    subject: `Your tour tickets - Order #${orderNumber}`,
    html: emailLayout({ title: 'Your tour tickets', body }),
  });
}

export async function emailContactMessage(name: string, email: string, subject: string, message: string) {
  const body = `
    <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) sent a message.</p>
    <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`;
  return sendMail({
    to: process.env.SUPPORT_EMAIL || 'support@example.com',
    subject: `New enquiry: ${subject}`,
    html: emailLayout({ title: 'New contact message', body }),
  });
}

export async function emailNewsletterWelcome(email: string) {
  const body = `<p>Thanks for subscribing! You will only hear about genuinely good trips.</p>`;
  return sendMail({
    to: email,
    subject: 'Welcome aboard',
    html: emailLayout({ title: 'Welcome aboard', body }),
  });
}
