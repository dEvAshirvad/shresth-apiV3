import env from '@/configs/env';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import logger from '@/configs/logger/winston';

export const DB_URL = env.MONGODB_URI!;

export const client = new MongoClient(DB_URL);
export const db = client.db();

/**
 * Production-grade MongoDB connection with connection pooling
 */
export default function connectDB() {
  return new Promise((resolve, reject) => {
    mongoose.set('strictQuery', false);

    // Connection pool options for production
    const connectionOptions: mongoose.ConnectOptions = {
      // Connection pool settings
      maxPoolSize: 10, // Maximum number of connections in the pool
      minPoolSize: 5, // Minimum number of connections to maintain
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      serverSelectionTimeoutMS: 5000, // How long to try selecting a server
      socketTimeoutMS: 45000, // How long to wait for a socket to be established
      // Retry settings
      retryWrites: true,
      retryReads: true,
      // Buffer settings
      bufferCommands: false, // Disable mongoose buffering
    };

    mongoose
      .connect(DB_URL, connectionOptions)
      .then(() => {
        const connection = mongoose.connection;

        // Log connection pool info
        logger.info('MongoDB connected successfully', {
          host: connection.host,
          port: connection.port,
          name: connection.name,
        });

        // Connection event handlers
        connection.on('error', (error) => {
          logger.error('MongoDB connection error:', error);
        });

        connection.on('disconnected', () => {
          logger.warn('MongoDB disconnected');
        });

        connection.on('reconnected', () => {
          logger.info('MongoDB reconnected');
        });

        resolve('Successfully connected to database');
      })
      .catch((error) => {
        logger.error('MongoDB connection failed:', error);
        reject(error);
      });
  });
}

export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
}
