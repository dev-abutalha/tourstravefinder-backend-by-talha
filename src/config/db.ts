import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

let connected = false;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    autoIndex: env.NODE_ENV !== 'production',
  });

  connected = true;
  logger.info({ uri: env.MONGODB_URI.replace(/\/\/.*@/, '//***@') }, 'MongoDB connected');

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => {
    connected = false;
    logger.warn('MongoDB disconnected');
  });

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  if (!connected) return;
  await mongoose.connection.close();
  connected = false;
}

export { mongoose };
