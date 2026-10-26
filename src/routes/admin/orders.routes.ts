import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { validate } from '../../middleware/error.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { Order, Product, ReviewToken, type OrderDoc } from '../../models/index.js';
import { updateOrderStatus, resolveCancellation, requestCancellation } from '../../services/order.service.js';
import { saveSecureTicket, removeSecureTicket, readSecureTicket } from '../../services/ticket.service.js';
import { renderInvoice } from '../../services/invoice.service.js';
import { emailTickets, emailReviewRequest } from '../../services/email.service.js';
import { ORDER_STATUSES } from '../../models/Order.js';

export const adminOrdersRouter = Router();

/* ------------------------------------------------------------------ */
/* List                                                               */
/* ------------------------------------------------------------------ */

const orderListSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  dateRange: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

function buildDateFilter(dateRange?: string, from?: string, to?: string): Record<string, unknown> {
  const now = dayjs();
  if (dateRange === 'today') return { createdAt: { $gte: now.startOf('day').toDate(), $lte: now.endOf('day').toDate() } };
  if (dateRange === 'yesterday') {
    const y = now.subtract(1, 'day');
    return { createdAt: { $gte: y.startOf('day').toDate(), $lte: y.endOf('day').toDate() } };
  }
  if (dateRange === '7days') return { createdAt: { $gte: now.subtract(7, 'day').toDate() } };
  if (dateRange === '30days') return { createdAt: { $gte: now.subtract(30, 'day').toDate() } };
  if (dateRange === 'this_month') return { createdAt: { $gte: now.startOf('month').toDate() } };
  if (dateRange === 'last_month') {
    const m = now.subtract(1, 'month');
    return { createdAt: { $gte: m.startOf('month').toDate(), $lte: m.endOf('month').toDate() } };
  }
  if (dateRange === 'this_year') return { createdAt: { $gte: now.startOf('year').toDate() } };
  if (dateRange === 'last_year') {
    const y = now.subtract(1, 'year');
    return { createdAt: { $gte: y.startOf('year').toDate(), $lte: y.endOf('year').toDate() } };
  }
  if (dateRange === 'custom' && from && to) {
    return { createdAt: { $gte: dayjs(from).startOf('day').toDate(), $lte: dayjs(to).endOf('day').toDate() } };
  }
  return {};
}

adminOrdersRouter.get(
  '/',
  validate(orderListSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof orderListSchema>;
    const { skip, limit, page } = paginate(q, q.page ?? 1, q.limit ?? 25);

    const filter: any = { ...buildDateFilter(q.dateRange, q.from, q.to) };

    if (q.status && q.status !== 'any') {
      filter.status = { $in: q.status.split(',').map((s) => s.trim()) };
    }
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ orderNumber: rx }, { customerEmail: rx }, { 'billing.firstName': rx }, { 'billing.lastName': rx }];
    }

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    res.json({
      success: true,
      data: orders.map((o) => summarise(o)),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

function summarise(order: OrderDoc) {
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    total: order.total,
    currency: order.currency,
    customerEmail: order.customerEmail,
    customerName: `${order.billing?.firstName ?? ''} ${order.billing?.lastName ?? ''}`.trim(),
    customerPhone: order.customerPhone,
    itemCount: order.items?.length ?? 0,
    firstItemTitle: order.items?.[0]?.productTitle ?? '',
    firstItemImage: order.items?.[0]?.productImage ?? '',
    travelerCount: order.travelerCount,
    fraudLevel: order.fraud?.level ?? 'allowed',
    fraudScore: order.fraud?.score ?? 0,
    cancelRequested: order.cancelRequested,
    createdAt: order.createdAt,
  };
}

adminOrdersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');
    res.json({ success: true, data: { ...order.toJSON(), id: String(order._id) } });
  }),
);

/* ------------------------------------------------------------------ */
/* Mutations                                                          */
/* ------------------------------------------------------------------ */

adminOrdersRouter.patch(
  '/:id/status',
  validate(
    z.object({
      status: z.enum(ORDER_STATUSES),
      note: z.string().max(1000).optional(),
      sendEmail: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { status: (typeof ORDER_STATUSES)[number]; note?: string; sendEmail?: boolean };
    const order = await updateOrderStatus(param(req, 'id'), body.status, {
      note: body.note,
      actor: req.user?.email,
      sendEmail: body.sendEmail,
    });
    res.json({ success: true, data: summarise(order) });
  }),
);

adminOrdersRouter.patch(
  '/:id/notes',
  validate(z.object({ adminNotes: z.string().max(5000) })),
  asyncHandler(async (req, res) => {
    const order = await Order.findByIdAndUpdate(
      param(req, 'id'),
      { $set: { adminNotes: (req.body as { adminNotes: string }).adminNotes } },
      { returnDocument: 'after' },
    );
    if (!order) throw notFound('Order not found.');
    res.json({ success: true, data: summarise(order) });
  }),
);

adminOrdersRouter.post(
  '/:id/cancellation/resolve',
  validate(
    z.object({
      decision: z.enum(['accept', 'reject']),
      reason: z.string().max(1000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { decision: 'accept' | 'reject'; reason?: string };
    const order = await resolveCancellation(param(req, 'id'), body.decision, req.user?.email ?? 'admin', body.reason);
    res.json({ success: true, data: summarise(order) });
  }),
);

adminOrdersRouter.post(
  '/:id/cancellation/request',
  validate(z.object({ reason: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const order = await requestCancellation(param(req, 'id'), undefined, (req.body as { reason?: string }).reason ?? '');
    res.json({ success: true, data: summarise(order) });
  }),
);

adminOrdersRouter.post(
  '/:id/refund',
  validate(
    z.object({
      amount: z.coerce.number().positive().optional(),
      note: z.string().max(1000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');
    const body = req.body as { amount?: number; note?: string };
    const refundAmount = body.amount ?? order.total;
    order.refunds = refundAmount;
    order.paymentStatus = 'refunded';
    if (order.status !== 'refunded') order.status = 'refunded';
    if (body.note) {
      order.adminNotes = [order.adminNotes, `Refund: ${refundAmount} ${order.currency} - ${body.note}`].filter(Boolean).join('\n');
    } else {
      order.adminNotes = [order.adminNotes, `Refund: ${refundAmount} ${order.currency}`].filter(Boolean).join('\n');
    }
    await order.save();
    try {
      const { emailOrderCancelled } = await import('../../services/email.service.js');
      await emailOrderCancelled({
        orderNumber: order.orderNumber,
        customerName: order.billing?.firstName ?? 'there',
        customerEmail: order.customerEmail,
        currency: order.currency,
        total: order.total,
        trackingUrl: `${process.env.SITE_URL ?? 'http://localhost:3000'}/order-tracker?order=${order.orderNumber}`,
        items: order.items.map((item) => ({
          title: item.productTitle,
          optionName: item.optionName,
          date: item.date,
          time: item.time,
          travelers: item.travelerCount,
          total: item.total,
        })),
      });
    } catch {}
    res.json({ success: true, data: summarise(order) });
  }),
);

/* ------------------------------------------------------------------ */
/* Downloads                                                          */
/* ------------------------------------------------------------------ */

adminOrdersRouter.get(
  '/:id/invoice',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');
    const { filename, buffer } = await renderInvoice(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

adminOrdersRouter.get(
  '/:id/tickets/:index/download',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');
    const index = Number(param(req, 'index'));
    const filePath = order.ticketFiles?.[index];
    if (!filePath) throw notFound('Ticket not found.');
    const { buffer, filename, mime } = await readSecureTicket(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

/* ------------------------------------------------------------------ */
/* Tickets                                                            */
/* ------------------------------------------------------------------ */

adminOrdersRouter.post(
  '/:id/tickets',
  validate(
    z.object({
      files: z
        .array(z.object({ filename: z.string(), content: z.string() }))
        .min(1, 'Attach at least one file'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');

    const files = (req.body as { files: { filename: string; content: string }[] }).files;
    const stored: string[] = [];

    for (const file of files) {
      const base64 = file.content.includes(',') ? file.content.split(',').pop()! : file.content;
      const buffer = Buffer.from(base64, 'base64');
      stored.push(await saveSecureTicket(buffer, file.filename, order.orderNumber));
    }

    order.ticketFiles = [...(order.ticketFiles ?? []), ...stored];
    await order.save();

    res.json({ success: true, data: { ticketFiles: order.ticketFiles } });
  }),
);

adminOrdersRouter.delete(
  '/:id/tickets/:index',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');

    const index = Number(param(req, 'index'));
    const filePath = order.ticketFiles?.[index];
    if (!filePath) throw notFound('Ticket not found.');

    await removeSecureTicket(filePath);
    order.ticketFiles.splice(index, 1);
    await order.save();

    res.json({ success: true, data: { ticketFiles: order.ticketFiles } });
  }),
);

adminOrdersRouter.post(
  '/:id/tickets/send',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');
    if (!order.ticketFiles?.length) throw badRequest('There are no tickets attached to this order yet.');

    await emailTickets(
      order.orderNumber,
      order.billing?.firstName ?? 'there',
      order.customerEmail,
      order.ticketFiles.length,
    );
    order.ticketSentAt = new Date();
    await order.save();

    res.json({ success: true, data: { sent: true } });
  }),
);

/* ------------------------------------------------------------------ */
/* Review request                                                     */
/* ------------------------------------------------------------------ */

adminOrdersRouter.post(
  '/:id/review-request',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(param(req, 'id'));
    if (!order) throw notFound('Order not found.');

    const product = order.items?.[0]?.productId ? await Product.findById(order.items[0].productId) : null;
    const token = `${order.orderNumber}-${Math.random().toString(36).slice(2, 12)}`;

    await ReviewToken.create({
      token,
      orderId: order._id,
      productId: order.items?.[0]?.productId ?? null,
      userId: order.userId,
      email: order.customerEmail,
      expiresAt: dayjs().add(14, 'day').toDate(),
    });

    await emailReviewRequest(
      order.orderNumber,
      order.billing?.firstName ?? 'there',
      order.customerEmail,
      product?.title ?? 'your tour',
      `${process.env.SITE_URL ?? 'http://localhost:3000'}/submit-review?token=${token}`,
    );

    order.reviewEnabled = true;
    order.reviewSentAt = new Date();
    order.reviewToken = token;
    await order.save();

    res.json({ success: true, data: { sent: true, token } });
  }),
);

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

const CSV_COLUMNS = [
  'Order ID',
  'Order Date',
  'Status',
  'Customer Name',
  'Email',
  'Phone',
  'Total',
  'Payment Method',
  'Items',
  'Travel Date',
  'Billing City',
  'Billing Country',
];

function csvCell(value: unknown): string {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

adminOrdersRouter.get(
  '/export/csv',
  validate(orderListSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof orderListSchema>;
    const filter: any = { ...buildDateFilter(q.dateRange, q.from, q.to) };
    if (q.status && q.status !== 'any') {
      filter.status = { $in: q.status.split(',').map((s) => s.trim()) };
    }
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ orderNumber: rx }, { customerEmail: rx }, { 'billing.firstName': rx }];
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(10_000);

    const rows = [
      CSV_COLUMNS.join(','),
      ...orders.map((order) =>
        [
          order.orderNumber,
          dayjs(order.createdAt).format('YYYY-MM-DD HH:mm'),
          order.status,
          `${order.billing?.firstName ?? ''} ${order.billing?.lastName ?? ''}`.trim(),
          order.customerEmail,
          order.customerPhone,
          order.total,
          order.paymentMethod,
          (order.items ?? []).map((i) => i.productTitle).join(' | '),
          (order.items ?? []).map((i) => i.date).filter(Boolean).join(' | '),
          order.billing?.city ?? '',
          order.billing?.country ?? '',
        ]
          .map(csvCell)
          .join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${dayjs().format('YYYY-MM-DD')}.csv"`);
    res.send(rows.join('\n'));
  }),
);
