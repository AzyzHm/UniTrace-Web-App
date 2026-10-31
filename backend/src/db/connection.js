import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

export async function connectDb(uri) {
  // Give up after 5 seconds instead of Mongoose's default 30, so a wrong URI or an unreachable
  // cluster shows up quickly at startup.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Only the database name is logged, never the URI, because it contains the credentials.
  logger.info(`MongoDB connected (database: ${mongoose.connection.name})`);
}

export async function disconnectDb() {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
