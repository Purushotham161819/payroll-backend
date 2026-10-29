import { ConflictException } from '@nestjs/common';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { User } from './auth.schema';

// A database-wide lock works on standalone MongoDB too. No lease expiry: a
// crashed writer fails closed until an operator stops all writers and clears it.
export async function withAccountLock<T>(
  users: Model<User>,
  work: () => Promise<T>,
): Promise<T> {
  const locks = users.db.collection<{
    _id: string;
    owner: string;
    createdAt: Date;
  }>('auth_management_locks');
  const owner = randomUUID();
  try {
    await locks.insertOne({ _id: 'accounts', owner, createdAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new ConflictException(
        'Another account operation is in progress. Please try again.',
      );
    throw error;
  }
  try {
    return await work();
  } finally {
    await locks.deleteOne({ _id: 'accounts', owner });
  }
}

export async function ensureUserIndexes(users: Model<User>) {
  await users.init();
  const indexes = await users.collection.indexes();
  const old = indexes.find(
    (index) =>
      index.unique &&
      Object.keys(index.key).length === 1 &&
      index.key.role === 1,
  );
  if (old?.name) await users.collection.dropIndex(old.name);
  await users.collection.createIndex({ email: 1 }, { unique: true });
}

export function publicUser(user: any) {
  return {
    id: user.id ?? String(user._id),
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
