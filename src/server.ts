import { createApp, prepareRuntime } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startJobs } from './jobs/scheduler.js';

async function bootstrap() {
  await prepareRuntime();
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `API listening on http://localhost:${env.PORT}`);
    logger.info(`Admin panel: ${env.API_URL}/admin`);
    logger.info(`Frontend origin allowed: ${env.FRONTEND_URL}`);
  });

  startJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled rejection'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
