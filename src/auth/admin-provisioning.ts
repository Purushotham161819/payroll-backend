import '../environment';
import mongoose from 'mongoose';
import * as argon2 from 'argon2';
import { isEmail } from 'class-validator';
import { User, UserSchema } from './auth.schema';
import { ensureUserIndexes, withAccountLock } from './account-storage';

export async function runAdminCommand(recover = false) {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  try {
    if (
      !email ||
      !isEmail(email) ||
      email.length > 254 ||
      !password ||
      password.length < 8 ||
      password.length > 128
    )
      throw new Error(
        'Supply a valid email. Password must be at least 8 characters long (maximum 128).',
      );
    await mongoose.connect(
      process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/payroll_db',
    );
    const users = mongoose.model<User>('AuthUser', UserSchema);
    await withAccountLock(users, async () => {
      await ensureUserIndexes(users);
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      if (recover) {
        const admin = await users
          .findOne({ email, role: 'admin' })
          .select('+sessionVersion');
        if (!admin)
          throw new Error('Recovery requires an existing administrator');
        admin.passwordHash = passwordHash;
        admin.active = true;
        admin.sessionVersion = (admin.sessionVersion ?? 0) + 1;
        await admin.save();
      } else {
        if (await users.exists({ role: 'admin' }))
          throw new Error('An administrator already exists');
        await users.create({
          email,
          passwordHash,
          active: true,
          role: 'admin',
        });
      }
    });
    console.log(
      recover
        ? 'Administrator recovered; previous sessions invalidated'
        : 'Administrator created',
    );
  } catch {
    console.error(
      recover
        ? 'Recovery refused. Password must be at least 8 characters long (maximum 128). Check credentials, existing administrator email, database configuration and account-operation lock.'
        : 'Setup refused. Password must be at least 8 characters long (maximum 128). Check email, database configuration, existing administrator and account-operation lock.',
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
