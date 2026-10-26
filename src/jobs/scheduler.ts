import cron from 'node-cron';
import dayjs from 'dayjs';
import { Order, ReviewToken, Cart } from '../models/index.js';
import { logger } from '../lib/logger.js';
import { emailOrderProcessing } from '../services/email.service.js';

/**
 * Background jobs.
 *
 * The original theme relied on WooCommerce Action Scheduler for the delayed
 * "under processing" email and a WP-Cron hourly review-request job. Both are
 * reimplemented here with node-cron.
 */

let started = false;

export function startJobs() {
  if (started) return;
  started = true;

  /** Orders that have been sitting in `pending` for over a minute get the
   *  "under processing" nudge, mirroring the theme's 60-second delay. */
  cron.schedule(
    '* * * * *',
    async () => {
      try {
        const cutoff = dayjs().subtract(1, 'minute').toDate();
        const orders = await Order.find({
          status: 'pending',
          paymentStatus: 'pending',
          createdAt: { $lte: cutoff },
          'meta.processingNudgeSent': { $ne: true },
        }).limit(25);

        for (const order of orders) {
          await emailOrderProcessing({
            orderNumber: order.orderNumber,
            customerName: order.billing?.firstName ?? 'there',
            customerEmail: order.customerEmail,
            currency: order.currency,
            total: order.total,
            trackingUrl: `${process.env.SITE_URL ?? ''}/order-status?order=${order.orderNumber}`,
            items: (order.items ?? []).map((i) => ({
              title: i.productTitle,
              optionName: i.optionName,
              date: i.date,
              time: i.time,
              travelers: i.travelerCount,
              total: i.total,
            })),
          });
          order.meta = { ...(order.meta ?? {}), processingNudgeSent: true };
          await order.save();
        }
      } catch (err) {
        logger.error({ err }, 'Processing nudge job failed');
      }
    },
    { timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Madrid' },
  );

  /** Expire stale review tokens. */
  cron.schedule(
    '17 * * * *',
    async () => {
      try {
        const result = await ReviewToken.deleteMany({ expiresAt: { $lt: new Date() }, used: false });
        if (result.deletedCount) logger.info({ count: result.deletedCount }, 'Expired review tokens purged');
      } catch (err) {
        logger.error({ err }, 'Review token cleanup failed');
      }
    },
    { timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Madrid' },
  );

  /** Clear expired carts. */
  cron.schedule(
    '*/10 * * * *',
    async () => {
      try {
        const result = await Cart.deleteMany({ expiresAt: { $lt: new Date() } });
        if (result.deletedCount) logger.info({ count: result.deletedCount }, 'Expired carts purged');
      } catch (err) {
        logger.error({ err }, 'Cart cleanup failed');
      }
    },
    { timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Madrid' },
  );

  logger.info('Background jobs scheduled');
}
