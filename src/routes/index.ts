import { Router } from 'express';
import { requireRole, refreshSession } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { catalogRouter } from './public/catalog.routes.js';
import { bookingRouter } from './public/booking.routes.js';
import { accountRouter } from './public/account.routes.js';
import { miscRouter } from './public/misc.routes.js';
import { adminProductsRouter } from './admin/products.routes.js';
import { adminOrdersRouter } from './admin/orders.routes.js';
import { adminTaxonomyRouter } from './admin/taxonomy.routes.js';
import { adminContentRouter } from './admin/content.routes.js';
import { adminReviewsRouter } from './admin/reviews.routes.js';
import { adminFraudRouter } from './admin/fraud.routes.js';
import { adminSettingsRouter } from './admin/settings.routes.js';
import { adminMiscRouter } from './admin/misc.routes.js';

export const apiRouter = Router();

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

apiRouter.use('/public', catalogRouter);
apiRouter.use('/public', bookingRouter);
apiRouter.use('/public', accountRouter);
apiRouter.use('/public', miscRouter);

apiRouter.post('/auth/refresh', refreshSession);

/* ------------------------------------------------------------------ */
/* Admin API                                                          */
/* ------------------------------------------------------------------ */

const admin = Router();
admin.use(requireRole('admin', 'manager'));

admin.use('/products', writeLimiter, adminProductsRouter);
admin.use('/orders', writeLimiter, adminOrdersRouter);
admin.use('/', writeLimiter, adminTaxonomyRouter);
admin.use('/', writeLimiter, adminContentRouter);
admin.use('/reviews', writeLimiter, adminReviewsRouter);
admin.use('/fraud', writeLimiter, adminFraudRouter);
admin.use('/settings', writeLimiter, adminSettingsRouter);
admin.use('/', writeLimiter, adminMiscRouter);

apiRouter.use('/admin', admin);
