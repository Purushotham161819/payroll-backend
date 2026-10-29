// Standalone operator entry point: never import main.ts or AppModule.
const path = require('node:path');

async function main() {
  const mode = process.argv[2];
  const role = process.argv[3] ?? 'admin';
  if (!['admin', 'super_admin'].includes(role)) { process.exitCode = 1; return; }
  if (!['create', 'recover'].includes(mode)) {
    console.error('Specify create or recover. Use npm.cmd run create-admin or npm.cmd run recover-admin.');
    process.exitCode = 1;
    return;
  }
  process.chdir(path.resolve(__dirname, '..'));
  let mongoose;
  let phase = 'configuration';
  try {
    require('ts-node/register');
    require('../src/environment');
    const { plainToInstance } = require('class-transformer');
    const { validateSync } = require('class-validator');
    const { CreateUserDto } = require('../src/auth/users.dto');
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    // Reuse the API's validation policy; do not print validation objects/values.
    if (validateSync(plainToInstance(CreateUserDto, { email, password, role: 'admin', active: true })).length) {
      console.error('Supply a valid BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD of 8-128 characters. No account was changed.');
      process.exitCode = 1;
      return;
    }
    mongoose = require('mongoose');
    phase = 'database';
    await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/payroll_db', { serverSelectionTimeoutMS: 5000 });
    // Read-only diagnostics. Atomic creation/recovery rules remain in the shared
    // provisioning function, which rechecks existence inside its MongoDB lock.
    const accounts = mongoose.connection.collection('authusers');
    if (mode === 'create' && await accounts.findOne({ role }, { projection: { _id: 1 } })) {
      console.error('An administrator already exists. Initial setup made no changes. If you lost access, explicitly run npm.cmd run recover-admin (or npm.cmd run recover-super-admin for the platform account).');
      process.exitCode = 1;
      return;
    }
    if (mode === 'recover' && !await accounts.findOne({ email, role }, { projection: { _id: 1 } })) {
      console.error('Recovery requires the email of an existing administrator. No account was changed. Use create-admin only if no administrator exists.');
      process.exitCode = 1;
      return;
    }
    phase = 'operation';
    const { runAdminCommand } = require('../src/auth/admin-provisioning');
    await runAdminCommand(mode === 'recover', role);
    if (process.exitCode) console.error('Check for a duplicate email or an account operation already in progress. Retry after it finishes; setup never falls back to recovery.');
  } catch {
    console.error(phase === 'configuration'
      ? 'Cannot initialize administrator CLI. Run npm.cmd ci in payroll-backend and check the local .env file and Node.js version.'
      : phase === 'database'
        ? 'Cannot connect to MongoDB. Check MONGODB_URI in the backend environment/.env, start MongoDB, and verify network access and database permissions. No credentials are displayed.'
        : 'Administrator operation failed. Check database permissions and the documented account-operation lock recovery procedure.');
    process.exitCode = 1;
  } finally {
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (mongoose) {
      try { await mongoose.disconnect(); }
      catch { console.error('Could not close the MongoDB connection cleanly.'); process.exitCode = 1; }
    }
  }
}
void main();
