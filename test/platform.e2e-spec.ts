import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import request from 'supertest';
import session from 'express-session';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { User } from '../src/auth/auth.schema';
import { configureSecurity } from '../src/auth/http-security';
import { PlatformService } from '../src/organizations/platform.service';

describe('Super Admin, onboarding, forced passwords and business-data isolation', () => {
  let app: NestExpressApplication, db: Connection, users: Model<User>;
  let superCookie: string,
    legacyCookie: string,
    aCookie: string,
    bCookie: string,
    memberCookie: string;
  let a: string,
    b: string,
    adminA: string,
    adminB: string,
    memberId: string,
    employeeA: string,
    componentA: string;
  const database = `payroll_platform_test_${randomBytes(8).toString('hex')}`;
  const uri = `mongodb://127.0.0.1:27017/${database}`;
  const password = randomBytes(6).toString('hex').slice(0, 8),
    replacement = randomBytes(6).toString('hex').slice(0, 8);
  const headers = { Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' };
  const cli = (
    mode = 'create',
    email = 'platform@example.test',
    input = password,
    target = uri,
  ) =>
    spawnSync(
      process.execPath,
      [resolve('scripts/admin-cli.cjs'), mode, 'super_admin'],
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          MONGODB_URI: target,
          BOOTSTRAP_ADMIN_EMAIL: email,
          BOOTSTRAP_ADMIN_PASSWORD: input,
          NODE_OPTIONS: `--require=${resolve('test/admin-cli-no-listen.cjs')}`,
        },
      },
    );
  const api = () => request(app.getHttpServer());
  let loginIp = 1;
  const login = async (email: string, input = password) => {
    const result = await api()
      .post('/auth/login')
      .set(headers)
      .set('X-Forwarded-For', '192.0.2.' + loginIp++)
      .send({ email, password: input })
      .expect(200);
    return result.headers['set-cookie'][0].split(';')[0] as string;
  };
  const onboard = (name: string, email: string) =>
    api()
      .post('/super-admin/organizations')
      .set(headers)
      .set('Cookie', superCookie)
      .send({ name, email, password, role: 'admin', active: true });
  const employee = {
    email: 'employee@example.test',
    firstName: 'Tenant',
    lastName: 'Employee',
    dateOfBirth: '1990-01-01',
    hireDate: '2024-01-01',
    annualCtc: 600000,
  };
  const settings = {
    wageCap: 15000,
    epfEmployerContributionPercentage: 12,
    epsEmployerContributionPercentage: 8.33,
    esiEmployerContributionPercentage: 3.25,
  };
  beforeAll(async () => {
    process.env.MONGODB_URI = uri;
    process.env.FRONTEND_ORIGIN = headers.Origin;
    process.env.SESSION_SECRET = randomBytes(48).toString('hex');
    expect(cli().status).toBe(0);
    const { AppModule } = require('../src/app.module');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    // Separate simulated clients preserve the real 10-attempt/IP limiter.
    app.set('trust proxy', 1);
    configureSecurity(app, new session.MemoryStore());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    db = app.get(getConnectionToken());
    users = app.get(getModelToken('AuthUser'));
    await users.create({
      email: 'legacy@example.test',
      role: 'admin',
      active: true,
      passwordHash: await argon2.hash(password),
    });
    superCookie = await login('platform@example.test');
    legacyCookie = await login('legacy@example.test');
  }, 40000);
  afterAll(async () => {
    if (db?.name === database && database.startsWith('payroll_platform_test_'))
      await db.dropDatabase();
    await app?.close();
  });
  it('CLI stores only Argon2id, refuses repeats without overwriting any credentials, and never listens', async () => {
    const before = await db.collection('authusers').find().toArray();
    expect(before.find((u) => u.role === 'super_admin')!.passwordHash).toMatch(
      /^\$argon2id\$/,
    );
    expect(cli().status).toBe(1);
    expect(cli('create', 'other@example.test').status).toBe(1);
    expect(await db.collection('authusers').find().toArray()).toEqual(before);
    expect(cli('create', 'invalid', '1234567').status).toBe(1);
  }, 60000);
  it('allows exactly one Super Admin during concurrent trusted setup', async () => {
    const raceDb = `payroll_platform_race_test_${randomBytes(8).toString('hex')}`;
    const run = (email: string) =>
      new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          [resolve('scripts/admin-cli.cjs'), 'create', 'super_admin'],
          {
            windowsHide: true,
            stdio: 'ignore',
            env: {
              ...process.env,
              MONGODB_URI: `mongodb://127.0.0.1:27017/${raceDb}`,
              BOOTSTRAP_ADMIN_EMAIL: email,
              BOOTSTRAP_ADMIN_PASSWORD: password,
              NODE_OPTIONS: `--require=${resolve('test/admin-cli-no-listen.cjs')}`,
            },
          },
        );
        child.on('error', reject);
        child.on('exit', done);
      });
    try {
      expect(
        (
          await Promise.all([run('one@example.test'), run('two@example.test')])
        ).sort(),
      ).toEqual([0, 1]);
      expect(
        await db
          .getClient()
          .db(raceDb)
          .collection('authusers')
          .countDocuments({ role: 'super_admin' }),
      ).toBe(1);
    } finally {
      await db.getClient().db(raceDb).dropDatabase();
    }
  }, 40000);
  it('protects platform APIs, preserves CSRF, and denies Super Admin customer business APIs', async () => {
    await api().get('/super-admin/dashboard').expect(401);
    await api()
      .get('/super-admin/dashboard')
      .set('Cookie', legacyCookie)
      .expect(403);
    await api()
      .post('/super-admin/organizations')
      .set('Cookie', superCookie)
      .send({})
      .expect(403);
    for (const route of [
      '/employees',
      '/salary-components',
      '/settings/statutory-deductions',
      '/payroll/annual',
      '/users',
    ])
      await api().get(route).set('Cookie', superCookie).expect(403);
  });
  it('onboards unique backend IDs with correctly scoped initial admins and rejects invalid/duplicate input', async () => {
    const first = await onboard('  Customer A  ', 'a@example.test').expect(201);
    a = first.body.organizationId;
    const second = await onboard('Customer B', 'b@example.test').expect(201);
    b = second.body.organizationId;
    expect(a).toMatch(/^ORG\d{6,}$/);
    expect(b).not.toBe(a);
    expect(
      await db.collection('organizations').findOne({ organizationId: a }),
    ).toMatchObject({ name: 'Customer A', status: 'active' });
    const firstAdmin = await users.findOne({ email: 'a@example.test' });
    adminA = firstAdmin!.id;
    adminB = (await users.findOne({ email: 'b@example.test' }))!.id;
    expect(firstAdmin).toMatchObject({
      organizationId: a,
      role: 'admin',
      mustChangePassword: true,
    });
    await onboard('customer a', 'different@example.test').expect(409);
    await onboard('Rejected duplicate email', 'a@example.test').expect(409);
    expect(await db.collection('organizations').countDocuments()).toBe(2);
    await onboard('  ', 'invalid-name@example.test').expect(400);
    await api()
      .post('/super-admin/organizations')
      .set(headers)
      .set('Cookie', superCookie)
      .send({
        name: 'X',
        email: 'x@example.test',
        password: '1234567',
        role: 'admin',
        active: true,
      })
      .expect(400);
  });
  it('fails onboarding safely when audit persistence fails', async () => {
    const service = app.get(PlatformService);
    const spy = jest
      .spyOn(service as any, 'audit')
      .mockRejectedValueOnce(new Error('simulated audit failure'));
    try {
      await onboard('Failed onboarding', 'failed@example.test').expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await users.exists({ email: 'failed@example.test' })).toBeNull();
    expect(
      await db
        .collection('organizations')
        .findOne({ name: 'Failed onboarding' }),
    ).toBeNull();
  });
  it('requires temporary-password replacement, rejects 7, accepts 8 and invalidates the temporary session', async () => {
    aCookie = await login('a@example.test');
    bCookie = await login('b@example.test');
    for (const cookie of [aCookie, bCookie]) {
      await api().get('/employees').set('Cookie', cookie).expect(403);
      await api()
        .get('/super-admin/dashboard')
        .set('Cookie', cookie)
        .expect(403);
      await api()
        .post('/auth/change-password')
        .set(headers)
        .set('Cookie', cookie)
        .send({ currentPassword: password, password: '1234567' })
        .expect(400);
      await api()
        .post('/auth/change-password')
        .set(headers)
        .set('Cookie', cookie)
        .send({ currentPassword: password, password: replacement })
        .expect(200);
      await api().get('/auth/me').set('Cookie', cookie).expect(401);
    }
    aCookie = await login('a@example.test', replacement);
    bCookie = await login('b@example.test', replacement);
    await api()
      .get('/settings/organization')
      .set('Cookie', aCookie)
      .expect(200, { displayName: 'Customer A' });
    await db
      .collection('organizations')
      .updateOne(
        { organizationId: a },
        { $set: { name: 'Renamed Customer A' } },
      );
    await api()
      .get('/settings/organization')
      .set('Cookie', aCookie)
      .expect(200, { displayName: 'Renamed Customer A' });
  });
  it('scopes login-account management, blocks ID forgery and protected role assignment', async () => {
    const created = await api()
      .post('/users')
      .set(headers)
      .set('Cookie', aCookie)
      .send({
        email: 'member@example.test',
        password,
        role: 'user',
        active: true,
      })
      .expect(201);
    memberId = created.body.id;
    memberCookie = await login('member@example.test');
    const list = await api().get('/users').set('Cookie', aCookie).expect(200);
    expect(list.body.map((u: any) => u.id).sort()).toEqual(
      [adminA, memberId].sort(),
    );
    await api()
      .patch(`/users/${adminB}/password`)
      .set(headers)
      .set('Cookie', aCookie)
      .send({ password })
      .expect(404);
    await api()
      .patch(`/users/${adminB}/status`)
      .set(headers)
      .set('Cookie', aCookie)
      .send({ active: false })
      .expect(404);
    await api()
      .patch(`/users/${adminA}`)
      .set(headers)
      .set('Cookie', aCookie)
      .send({ email: 'a@example.test', role: 'super_admin' })
      .expect(400);
    await api()
      .post('/users')
      .set(headers)
      .set('Cookie', aCookie)
      .send({
        email: 'forged@example.test',
        password,
        role: 'user',
        active: true,
        organizationId: b,
      })
      .expect(400);
    await api().get('/users').set('Cookie', memberCookie).expect(403);
    await api()
      .get('/super-admin/organizations')
      .set('Cookie', memberCookie)
      .expect(403);
    const legacy = await api()
      .get('/users')
      .set('Cookie', legacyCookie)
      .expect(200);
    expect(legacy.body.map((u: any) => u.email)).toEqual([
      'legacy@example.test',
    ]);
  });
  it('isolates employees, identifiers, indexes, and forged cross-tenant reads and writes', async () => {
    await api().get('/employees').set('Cookie', aCookie).expect(200, []);
    const first = await api()
      .post('/employees')
      .set(headers)
      .set('Cookie', aCookie)
      .send(employee)
      .expect(201);
    employeeA = first.body._id;
    const second = await api()
      .post('/employees')
      .set(headers)
      .set('Cookie', bCookie)
      .send(employee)
      .expect(201);
    expect(first.body.employeeId).toBe('EMP001');
    expect(second.body.employeeId).toBe('EMP001');
    expect(second.body._id).not.toBe(employeeA);
    await api()
      .get(`/employees/${employeeA}`)
      .set('Cookie', bCookie)
      .expect(404);
    await api()
      .patch(`/employees/${employeeA}`)
      .set(headers)
      .set('Cookie', bCookie)
      .send({ firstName: 'Stolen' })
      .expect(404);
    await api()
      .delete(`/employees/${employeeA}`)
      .set(headers)
      .set('Cookie', bCookie)
      .expect(404);
    const forged = await api()
      .get('/employees?organizationId=' + a)
      .set('Cookie', bCookie)
      .set('X-Organization-ID', a)
      .expect(200);
    expect(forged.body.map((r: any) => r._id)).toEqual([second.body._id]);
    const parallel = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api()
          .get('/employees')
          .set('Cookie', i % 2 ? aCookie : bCookie)
          .expect(200),
      ),
    );
    parallel.forEach((result, i) =>
      expect(result.body.map((r: any) => r._id)).toEqual([
        i % 2 ? employeeA : second.body._id,
      ]),
    );
    await api().get('/employees').set('Cookie', legacyCookie).expect(200, []);
    expect(await db.collection('employees').countDocuments()).toBe(0);
    expect(
      await db.collection(a.toLowerCase() + '_employees').countDocuments(),
    ).toBe(1);
  });
  it('isolates salary components, statutory settings and payroll reports', async () => {
    const first = await api()
      .get('/salary-components')
      .set('Cookie', aCookie)
      .expect(200);
    const second = await api()
      .get('/salary-components')
      .set('Cookie', bCookie)
      .expect(200);
    expect(first.body).toHaveLength(3);
    expect(second.body).toHaveLength(3);
    componentA = first.body[0]._id;
    expect(second.body.map((c: any) => c._id)).not.toContain(componentA);
    await api()
      .delete(`/salary-components/${componentA}`)
      .set(headers)
      .set('Cookie', bCookie)
      .expect(404);
    await api()
      .put('/settings/statutory-deductions')
      .set(headers)
      .set('Cookie', aCookie)
      .send(settings)
      .expect(200);
    const unset = await api()
      .get('/settings/statutory-deductions')
      .set('Cookie', bCookie)
      .expect(200);
    expect(unset.text === '' || unset.body === null).toBe(true);
    await api().get('/payroll/annual').set('Cookie', bCookie).expect(400);
    for (const c of first.body)
      await api()
        .patch('/salary-components/' + c._id)
        .set(headers)
        .set('Cookie', aCookie)
        .send({
          calculationValue: c.code === 'BASIC' ? 40 : c.code === 'DA' ? 10 : 20,
        })
        .expect(200);
    const payroll = await api()
      .get('/payroll/annual')
      .set('Cookie', aCookie)
      .expect(200);
    expect(payroll.body.employees.map((r: any) => r.employee._id)).toEqual([
      employeeA,
    ]);
  });
  it('lists only organization login accounts, supports pagination, and reports real totals', async () => {
    const result = await api()
      .get(`/super-admin/organizations/${a}/accounts?role=user&limit=1&page=1`)
      .set('Cookie', superCookie)
      .expect(200);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0].id).toBe(memberId);
    expect(result.body.items[0].passwordHash).toBeUndefined();
    const totals = await api()
      .get('/super-admin/dashboard')
      .set('Cookie', superCookie)
      .expect(200);
    expect(totals.body).toEqual({
      organizations: 2,
      activeOrganizations: 2,
      admins: 2,
      users: 1,
    });
    await api()
      .get('/super-admin/organizations?limit=0')
      .set('Cookie', superCookie)
      .expect(400);
    await api()
      .get(`/super-admin/organizations/${a}/accounts?role=super_admin`)
      .set('Cookie', superCookie)
      .expect(400);
  });
  it('preserves the initial administrator when activation commits but its acknowledgement is lost', async () => {
    const collection = db.collection('organizations');
    const original = collection.updateOne.bind(collection);
    const spy = jest
      .spyOn(collection, 'updateOne')
      .mockImplementation(async (...args: any[]) => {
        const result = await (original as any)(...args);
        if (args[1]?.$set?.status === 'active')
          throw new Error('simulated lost activation acknowledgement');
        return result;
      });
    try {
      const result = await onboard(
        'Activation acknowledged late',
        'late-ack@example.test',
      ).expect(201);
      expect(
        await users.findOne({ email: 'late-ack@example.test' }),
      ).toMatchObject({
        organizationId: result.body.organizationId,
        role: 'admin',
        active: true,
      });
      expect(
        await db
          .collection('organizations')
          .findOne({ organizationId: result.body.organizationId }),
      ).toMatchObject({ status: 'active' });
    } finally {
      spy.mockRestore();
    }
  });
  it('creates and manages scoped customer accounts with audited status changes', async () => {
    const path = `/super-admin/organizations/${b}/accounts`;
    const created = await api()
      .post(path)
      .set(headers)
      .set('Cookie', superCookie)
      .send({
        email: 'platform-created@example.test',
        role: 'user',
        active: true,
        password,
      })
      .expect(201);
    const id = created.body.id;
    expect(created.body.passwordHash).toBeUndefined();
    expect(await users.findById(id)).toMatchObject({
      organizationId: b,
      role: 'user',
      mustChangePassword: true,
    });
    await api()
      .patch(path + '/' + id)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ email: 'platform-created@example.test', role: 'super_admin' })
      .expect(400);
    const cookie = await login('platform-created@example.test');
    await api()
      .patch(path + '/' + id + '/status')
      .set(headers)
      .set('Cookie', superCookie)
      .send({ active: false })
      .expect(200);
    await api().get('/auth/me').set('Cookie', cookie).expect(401);
    const events = await api()
      .get(`/super-admin/organizations/${b}/audit`)
      .set('Cookie', superCookie)
      .expect(200);
    expect(
      events.body.items.some(
        (event: any) =>
          event.action === 'account.user.created' && event.accountId === id,
      ),
    ).toBe(true);
    expect(
      events.body.items.some(
        (event: any) =>
          event.action === 'account.deactivated' && event.accountId === id,
      ),
    ).toBe(true);
    const superAccount = await users.findOne({ role: 'super_admin' });
    await api()
      .patch(path + '/' + superAccount!.id + '/password')
      .set(headers)
      .set('Cookie', superCookie)
      .send({ password })
      .expect(404);
  });
  it('protects the last active admin and resets credentials without changing role or ownership', async () => {
    await api()
      .patch(`/super-admin/organizations/${a}/accounts/${adminA}/status`)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ active: false })
      .expect(409);
    await api()
      .patch(`/super-admin/organizations/${a}/accounts/${adminB}/password`)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ password })
      .expect(404);
    await api()
      .patch(`/super-admin/organizations/${a}/accounts/${memberId}/password`)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ password: '1234567' })
      .expect(400);
    await api()
      .patch(`/super-admin/organizations/${a}/accounts/${memberId}/password`)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ password: replacement })
      .expect(200);
    await api().get('/auth/me').set('Cookie', memberCookie).expect(401);
    expect(await users.findById(memberId)).toMatchObject({
      role: 'user',
      organizationId: a,
      mustChangePassword: true,
    });
    memberCookie = await login('member@example.test', replacement);
    await api().get('/employees').set('Cookie', memberCookie).expect(403);
    const audit = await api()
      .get(`/super-admin/organizations/${a}/audit?limit=100`)
      .set('Cookie', superCookie)
      .expect(200);
    expect(
      audit.body.items.some(
        (e: any) => e.action === 'password.reset.completed',
      ),
    ).toBe(true);
    expect(JSON.stringify(audit.body)).not.toContain(replacement);
    expect(JSON.stringify(audit.body)).not.toContain('passwordHash');
  });
  it('blocks inactive organizations immediately and does not revive old sessions on reactivation', async () => {
    await api()
      .patch(`/super-admin/organizations/${b}/status`)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ active: false })
      .expect(200);
    await api().get('/employees').set('Cookie', bCookie).expect(401);
    await api()
      .post('/auth/login')
      .set(headers)
      .send({ email: 'b@example.test', password: replacement })
      .expect(401);
    await api()
      .patch(`/super-admin/organizations/${b}/status`)
      .set(headers)
      .set('Cookie', superCookie)
      .send({ active: true })
      .expect(200);
    await api().get('/auth/me').set('Cookie', bCookie).expect(401);
    bCookie = await login('b@example.test', replacement);
    await api().get('/employees').set('Cookie', bCookie).expect(200);
  });
  it('dedicated Super Admin recovery invalidates sessions and preserves customer credentials', async () => {
    const before = await db
      .collection('authusers')
      .find({ role: { $ne: 'super_admin' } })
      .toArray();
    expect(cli('recover', 'platform@example.test', replacement).status).toBe(0);
    expect(
      await db
        .collection('authusers')
        .find({ role: { $ne: 'super_admin' } })
        .toArray(),
    ).toEqual(before);
    await api()
      .get('/super-admin/dashboard')
      .set('Cookie', superCookie)
      .expect(401);
    superCookie = await login('platform@example.test', replacement);
    await api()
      .post('/auth/logout')
      .set(headers)
      .set('Cookie', superCookie)
      .expect(204);
    await api().get('/auth/me').set('Cookie', superCookie).expect(401);
  }, 30000);
});
