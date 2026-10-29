import { Test } from '@nestjs/testing';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Connection, Model } from 'mongoose';
import request from 'supertest';
import MongoStore from 'connect-mongo';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { User } from '../src/auth/auth.schema';
import { configureSecurity } from '../src/auth/http-security';
import { ModulesContainer } from '@nestjs/core';
import { AuthController } from '../src/auth/auth.controller';

describe('Authentication and complete route audit (isolated Mongo database)', () => {
  let app: NestExpressApplication,
    connection: Connection,
    users: Model<User>,
    store: MongoStore;
  let cookie: string;
  let id: string;
  const email = 'security-test@example.test',
    password = randomBytes(24).toString('base64url');
  const origin = 'http://localhost:4200';
  const database = `payroll_auth_test_${randomBytes(8).toString('hex')}`;
  const uri = `mongodb://127.0.0.1:27017/${database}`;
  const headers = { Origin: origin, 'X-Payroll-Request': '1' };
  beforeAll(async () => {
    process.env.SESSION_SECRET = randomBytes(48).toString('hex');
    process.env.FRONTEND_ORIGIN = origin;
    process.env.MONGODB_URI = uri;
    // Load the real application only after selecting this suite's isolated DB.
    // Future controllers imported by AppModule are included in the audit too.
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken('AuthUser'));
    store = MongoStore.create({ mongoUrl: uri });
    configureSecurity(app, store);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await users.init();
    const provision = spawnSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        resolve(__dirname, '../src/auth/bootstrap-admin.ts'),
      ],
      {
        cwd: resolve(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: uri,
          BOOTSTRAP_ADMIN_EMAIL: email,
          BOOTSTRAP_ADMIN_PASSWORD: password,
        },
      },
    );
    expect(provision.status).toBe(0);
    id = (await users.findOne({ email }))!.id;
  }, 30000);
  afterAll(async () => {
    if (
      connection?.name === database &&
      database.startsWith('payroll_auth_test_')
    )
      await connection.dropDatabase();
    await store?.close();
    await app?.close();
  });
  const login = () =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email, password });
  it('refuses to overwrite or duplicate the bootstrapped administrator', () => {
    const provision = spawnSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        resolve(__dirname, '../src/auth/bootstrap-admin.ts'),
      ],
      {
        cwd: resolve(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: uri,
          BOOTSTRAP_ADMIN_EMAIL: 'second@example.test',
          BOOTSTRAP_ADMIN_PASSWORD: password,
        },
      },
    );
    expect(provision.status).toBe(1);
    expect(provision.stderr).not.toContain(password);
  }, 15000);
  it('rejects invalid inputs, credentials, unknown emails, and disabled accounts generically', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: 'bad', password })
      .expect(400);
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email, password: 'wrong-password' })
      .expect(401);
    const missing = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: 'missing@example.test', password })
      .expect(401);
    expect(wrong.body).toEqual(missing.body);
    await users.updateOne({ _id: id }, { active: false });
    expect((await login().expect(401)).body).toEqual(wrong.body);
    await users.updateOne({ _id: id }, { active: true });
  });
  it('logs in, stores Argon2id only, normalizes emails, and never exposes hashes', async () => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: email.toUpperCase(), password })
      .expect(200);
    cookie = result.headers['set-cookie'][0].split(';')[0];
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(result.body).toEqual({ id, email, role: 'admin' });
    const stored = await users.findById(id).select('+passwordHash');
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(stored!.passwordHash, password)).toBe(true);
    expect((await users.findById(id))!.passwordHash).toBeUndefined();
    await expect(
      users.create({ email: email.toUpperCase(), passwordHash: 'unused' }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/me')
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    ).toEqual({ id, email, role: 'admin' });
  });
  it('discovers every registered route, allows only login publicly, and admits authenticated requests', async () => {
    let count = 0;
    for (const module of app.get(ModulesContainer).values())
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype!;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          const method = Reflect.getMetadata(METHOD_METADATA, handler);
          if (method === undefined) continue;
          const path =
            '/' +
            [
              Reflect.getMetadata(PATH_METADATA, controller),
              Reflect.getMetadata(PATH_METADATA, handler),
            ]
              .filter(Boolean)
              .join('/')
              .split('/')
              .filter(Boolean)
              .join('/')
              .replace(/:id/g, '000000000000000000000000');
          const verb = RequestMethod[method].toLowerCase() as
            'get' | 'post' | 'patch' | 'put' | 'delete';
          if (controller === AuthController && name === 'login') continue;
          count++;
          await request(app.getHttpServer())[verb](path).send({}).expect(401);
          if (name !== 'logout') {
            const result = await request(app.getHttpServer())
              [verb](path)
              .set(headers)
              .set('Cookie', cookie)
              .send({});
            expect([401, 403, 500]).not.toContain(result.status);
          }
        }
      }
    expect(count).toBe(25);
  });
  it('serves only the configured organization name to authenticated requests', async () => {
    const original = process.env.ORGANIZATION_NAME;
    try {
      process.env.ORGANIZATION_NAME = '  Customer Organization with Regional Operations  ';
      await request(app.getHttpServer()).get('/settings/organization').expect(401);
      const response = await request(app.getHttpServer()).get('/settings/organization').set('Cookie', cookie).expect(200);
      expect(response.body).toEqual({displayName:'Customer Organization with Regional Operations'});
      process.env.ORGANIZATION_NAME = 'Changed Customer';
      expect((await request(app.getHttpServer()).get('/settings/organization').set('Cookie', cookie).expect(200)).body.displayName).toBe('Changed Customer');
    } finally { if (original === undefined) delete process.env.ORGANIZATION_NAME; else process.env.ORGANIZATION_NAME = original; }
  });
  it('rejects CSRF, invalid cookies and deactivated accounts', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set({ ...headers, Origin: 'https://attacker.test' })
      .send({ email, password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set({ ...headers, Origin: 'https://attacker.test' })
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/employees')
      .set('Cookie', 'payroll.sid=invalid')
      .expect(401);
    await users.updateOne({ _id: id }, { active: false });
    await request(app.getHttpServer())
      .get('/employees')
      .set('Cookie', cookie)
      .expect(401);
    await users.updateOne({ _id: id }, { active: true });
  });
  it('invalidates the server session on logout, including a replayed cookie', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set(headers)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get('/employees')
      .set('Cookie', cookie)
      .expect(401);
  });
  it('rejects absolute session expiration even before Mongo TTL cleanup', async () => {
    const result = await login().expect(200);
    const expiredCookie = result.headers['set-cookie'][0].split(';')[0];
    const records = await connection.collection('sessions').find().toArray();
    for (const record of records) {
      const data = JSON.parse(record.session);
      data.expiresAt = Date.now() - 1;
      await connection
        .collection('sessions')
        .updateOne(
          { _id: record._id },
          { $set: { session: JSON.stringify(data) } },
        );
    }
    await request(app.getHttpServer())
      .get('/employees')
      .set('Cookie', expiredCookie)
      .expect(401);
  });
  it('rate limits repeated login attempts', async () => {
    let limited = false;
    for (let n = 0; n < 11; n++) {
      if ((await login()).status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
