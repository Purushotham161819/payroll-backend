import { ConflictException } from '@nestjs/common';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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

async function userIndexesReady(users: Model<User>) {
  await users.init();
  const indexes = await users.collection.indexes();
  const emailUnique = indexes.some(index => index.unique &&
    Object.keys(index.key).length === 1 && index.key.email === 1 &&
    !index.sparse && !index.partialFilterExpression);
  const obsoleteRoleUnique = indexes.some(index => index.unique &&
    Object.keys(index.key).length === 1 && index.key.role === 1);
  return emailUnique && !obsoleteRoleUnique;
}

// Normal startup is a readiness check, not an account mutation. Only an actual
// index migration needs the shared write lock. Never infer stale ownership from
// age or delete another operation's lock to make startup succeed.
export async function initializeUserIndexes(users: Model<User>) {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await userIndexesReady(users)) return;
    try {
      await withAccountLock(users, async () => {
        // Another initializer may have finished between the check and the lock.
        if (!await userIndexesReady(users)) await ensureUserIndexes(users);
      });
      return;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      if (Date.now() >= deadline) {
        if (await userIndexesReady(users)) return;
        throw new Error('User index initialization is incomplete and another account operation holds the lock. Wait for it to finish and retry startup. If the operation was interrupted, verify all writers are stopped before following the documented lock recovery procedure. No lock was removed.');
      }
      await delay(100);
    }
  }
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
