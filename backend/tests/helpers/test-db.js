import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// In-memory MongoDB: integration tests never touch Atlas or a shared database.
let server;

export async function connectTestDb() {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
}

// Empties the collections without dropping them, so the indexes created by the models survive.
export async function clearTestDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

export async function disconnectTestDb() {
  await mongoose.disconnect();
  await server?.stop();
}
