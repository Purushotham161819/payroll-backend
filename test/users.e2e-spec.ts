import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { User } from '../src/auth/auth.schema';
import { UsersService } from '../src/auth/users.service';
import { configureSecurity } from '../src/auth/http-security';

describe('Administrator provisioning, authorization and user management', () => {
  let app: NestExpressApplication, connection: Connection, users: Model<User>;
  let adminId: string, adminCookie: string, userId: string, userCookie: string;
  const database = `payroll_users_test_${randomBytes(8).toString('hex')}`;
  const uri = `mongodb://127.0.0.1:27017/${database}`;
  const adminEmail = 'operator@example.test',
    email = 'member@example.test';
  const password = randomBytes(8).toString('hex').slice(0, 8),
    replacement = randomBytes(8).toString('hex').slice(0, 8);
  const headers = { Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' };
  const provision = (
    recover: boolean,
    targetEmail: string,
    newPassword = password,
  ) =>
    spawnSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        resolve(
          __dirname,
          recover
            ? '../src/auth/recover-admin.ts'
            : '../src/auth/bootstrap-admin.ts',
        ),
      ],
      {
        cwd: resolve(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: uri,
          BOOTSTRAP_ADMIN_EMAIL: targetEmail,
          BOOTSTRAP_ADMIN_PASSWORD: newPassword,
        },
      },
    );
  const login = async (targetEmail: string, input = password) => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: targetEmail, password: input })
      .expect(200);
    return result.headers['set-cookie'][0].split(';')[0];
  };
  beforeAll(async () => {
    process.env.MONGODB_URI = uri;
    process.env.FRONTEND_ORIGIN = headers.Origin;
    process.env.SESSION_SECRET = randomBytes(48).toString('hex');
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureSecurity(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken('AuthUser'));
    expect(provision(false, adminEmail).status).toBe(0);
    adminId = (await users.findOne({ email: adminEmail }))!.id;
    adminCookie = await login(adminEmail);
  }, 30000);
  afterAll(async () => {
    if (
      connection?.name === database &&
      database.startsWith('payroll_users_test_')
    )
      await connection.dropDatabase();
    await app?.close();
  });
  const admin = () =>
    request.agent(app.getHttpServer()).set(headers).set('Cookie', adminCookie);
  const member = () =>
    request.agent(app.getHttpServer()).set(headers).set('Cookie', userCookie);
  it('migrates the obsolete unique-role index without changing accounts', async () => {
    await users.collection.createIndex({ role: 1 }, { unique: true });
    await app.get(UsersService).onModuleInit();
    expect(
      (await users.collection.indexes()).some(
        (index) => index.unique && index.key.role === 1,
      ),
    ).toBe(false);
    expect(await users.countDocuments()).toBe(1);
  });
  it('allows an admin to create users, normalize emails and reject duplicates and invalid input', async () => {
    const response = await admin()
      .post('/users')
      .send({
        email: '  MEMBER@EXAMPLE.TEST  ',
        password,
        role: 'user',
        active: true,
      })
      .expect(201);
    userId = response.body.id;
    expect(response.body).toMatchObject({ email, role: 'user', active: true });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('sessionVersion');
    const stored = await users.findById(userId).select('+passwordHash');
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(stored!.passwordHash, password)).toBe(true);
    await admin()
      .post('/users')
      .send({
        email: email.toUpperCase(),
        password,
        role: 'user',
        active: true,
      })
      .expect(409);
    await admin()
      .post('/users')
      .send({ email: 'bad', password: 'short', role: 'owner', active: 'yes' })
      .expect(400);
    await admin()
      .patch('/users/not-an-id')
      .send({ email, role: 'user' })
      .expect(400);
    await admin()
      .patch('/users/000000000000000000000000')
      .send({ email, role: 'user' })
      .expect(404);
    expect((await admin().get('/users').expect(200)).body).toHaveLength(2);
  });
  it('rejects seven-character creation, reset and operator passwords', async () => {
    await admin().post('/users').send({email:'short@example.test',password:'1234567',role:'user',active:true}).expect(400);
    const reset = await admin().patch(`/users/${userId}/password`).send({password:'1234567'}).expect(400);
    expect(reset.body.message).toContain('Password must be at least 8 characters long.');
    expect(provision(false,'short@example.test','1234567').status).toBe(1);
    expect(provision(true,adminEmail,'1234567').status).toBe(1);
    expect(await users.exists({email:'short@example.test'})).toBeNull();
  },30000);
  it('denies ordinary users every management endpoint, including self-promotion', async () => {
    userCookie = await login(email);
    await member().get('/employees').expect(200);
    await member().get('/users').expect(403);
    await member()
      .post('/users')
      .send({
        email: 'attacker@example.test',
        password,
        role: 'admin',
        active: true,
      })
      .expect(403);
    await member()
      .patch(`/users/${userId}`)
      .send({ email, role: 'admin' })
      .expect(403);
    await member()
      .patch(`/users/${adminId}/password`)
      .send({ password: replacement })
      .expect(403);
    await member()
      .patch(`/users/${adminId}/status`)
      .send({ active: false })
      .expect(403);
    expect((await users.findById(userId))!.role).toBe('user');
  });
  it('preserves the last active admin and rejects self-deactivation/demotion, including uppercase IDs', async () => {
    await admin()
      .patch(`/users/${adminId.toUpperCase()}/status`)
      .send({ active: false })
      .expect(409);
    await admin()
      .patch(`/users/${adminId.toUpperCase()}`)
      .send({ email: adminEmail, role: 'user' })
      .expect(409);
    await admin().delete(`/users/${adminId}`).expect(404);
    expect(await users.countDocuments({ role: 'admin', active: true })).toBe(1);
  });
  it('deactivates users immediately, blocks login, and prevents old sessions reviving after activation', async () => {
    await admin()
      .patch(`/users/${userId}/status`)
      .send({ active: false })
      .expect(200);
    await member().get('/employees').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email, password })
      .expect(401);
    await admin()
      .patch(`/users/${userId}/status`)
      .send({ active: true })
      .expect(200);
    await member().get('/employees').expect(401);
    userCookie = await login(email);
    await member().get('/employees').expect(200);
  });
  it('edits roles and emails and revokes sessions when access details change', async () => {
    await admin()
      .patch(`/users/${userId}`)
      .send({ email, role: 'admin' })
      .expect(200);
    await member().get('/users').expect(401);
    userCookie = await login(email);
    await member().get('/users').expect(200);
    await admin()
      .patch(`/users/${userId}`)
      .send({ email, role: 'user' })
      .expect(200);
    await member().get('/users').expect(401);
    userCookie = await login(email);
    await member().get('/users').expect(403);
  });
  it('hashes password resets, revokes sessions and permits only the new password', async () => {
    await admin()
      .patch(`/users/${userId}/password`)
      .send({ password: replacement })
      .expect(200);
    await member().get('/employees').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email, password })
      .expect(401);
    userCookie = await login(email, replacement);
    await member().get('/employees').expect(200);
    const response = await admin().get('/users').expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|sessionVersion|\$argon2/,
    );
  });
  it('serializes competing administrator mutations and rechecks the actor inside the lock', async () => {
    await admin()
      .patch(`/users/${userId}`)
      .send({ email, role: 'admin' })
      .expect(200);
    const secondAdminCookie = await login(email, replacement);
    const result = await Promise.all([
      admin().patch(`/users/${userId}/status`).send({ active: false }),
      request(app.getHttpServer())
        .patch(`/users/${adminId}/status`)
        .set(headers)
        .set('Cookie', secondAdminCookie)
        .send({ active: false }),
    ]);
    expect(result.filter((r) => r.status === 200)).toHaveLength(1);
    expect(result.every((r) => [200, 401, 403, 409].includes(r.status))).toBe(
      true,
    );
    expect(await users.countDocuments({ role: 'admin', active: true })).toBe(1);
  });
  it('recovers only an existing admin through the controlled CLI and invalidates prior sessions', () => {
    expect(provision(true, adminEmail, replacement).status).toBe(0);
    expect(provision(true, 'missing@example.test').status).toBe(1);
    expect(provision(false, 'another@example.test').status).toBe(1);
  }, 30000);
  it('rejects old admin sessions after recovery and retains the account identity', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', adminCookie)
      .expect(401);
    // Verify recovery without another login attempt on this rate-limited test IP.
    const recovered = await users
      .findById(adminId)
      .select('+passwordHash +sessionVersion');
    expect(recovered!.active).toBe(true);
    expect(await argon2.verify(recovered!.passwordHash, replacement)).toBe(
      true,
    );
  });
});
