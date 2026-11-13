import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Connection, Model, Types } from 'mongoose';
import { MongoClient } from 'mongodb';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import session from 'express-session';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { EmailService } from './email.service';
import { User } from './auth.schema';
import { hashPassword } from './password-hashing';
import { configureSecurity } from './http-security';
import { EmployeesModule } from '../employees/employees.module';
import { RunPayrollModule } from '../run-payroll/run-payroll.module';

describe('Private Mode (isolated employee API and OTP integration)', () => {
  let app: NestExpressApplication,
    db: Connection,
    users: Model<User>,
    client: MongoClient,
    mongo: ChildProcess;
  let cookie: string,
    otherSession: string,
    peerCookie: string,
    adminCookie: string,
    userCookie: string,
    employeeAccount: any;
  const id = new Types.ObjectId(),
    peer = new Types.ObjectId(),
    org = 'ORG800001';
  const headers = { Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' },
    password = 'private-mode-test-password';
  const messages: { to: string; content: any }[] = [];
  let failMail = false;
  const email = {
    passwordChanged: jest.fn(),
    send: jest.fn(async (to: string, content: any) => {
      if (failMail) throw new Error('Controlled mail failure');
      messages.push({ to, content });
    }),
  };
  const post = (path: string, body = {}, sessionCookie = cookie) =>
    request(app.getHttpServer())
      .post('/employee-portal/private-mode/' + path)
      .set(headers)
      .set('Cookie', sessionCookie)
      .send(body);
  const profile = (sessionCookie = cookie) =>
    request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', sessionCookie);
  const login = async (address: string) => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: address, password })
      .expect(200);
    return result.headers['set-cookie'][0].split(';')[0];
  };
  const code = () => /code is: (\d{6})/.exec(messages.at(-1)!.content.text)![1];
  const clearLimits = async () => {
    await db.collection('employee_private_mode_limits').deleteMany({});
  };
  beforeAll(async () => {
    const socket = createServer();
    await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r));
    const port = (socket.address() as any).port;
    await new Promise<void>((r) => socket.close(() => r()));
    const dir = mkdtempSync(join(tmpdir(), 'paystream-private-mode-'));
    mongo = spawn(
      process.env.MONGOD_BINARY ||
        'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe',
      [
        '--dbpath',
        dir,
        '--port',
        String(port),
        '--bind_ip',
        '127.0.0.1',
        '--logpath',
        join(dir, 'mongo.log'),
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    client = new MongoClient(`mongodb://127.0.0.1:${port}`, {
      serverSelectionTimeoutMS: 400,
    });
    let ready = false;
    for (let n = 0; n < 40; n++) {
      try {
        await client.connect();
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!ready) throw new Error('Isolated MongoDB did not start');
    process.env.SESSION_SECRET = randomBytes(48).toString('hex');
    process.env.FRONTEND_ORIGIN = headers.Origin;
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(`mongodb://127.0.0.1:${port}/private_mode_test`),
        AuthModule,
        EmployeesModule,
        RunPayrollModule,
      ],
    })
      .overrideProvider(EmailService)
      .useValue(email)
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureSecurity(app, new session.MemoryStore());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(getConnectionToken());
    users = app.get(getModelToken('AuthUser'));
    await db
      .collection('organizations')
      .insertOne({
        organizationId: org,
        name: 'Privacy Test',
        normalizedName: 'privacy test',
        status: 'active',
      });
    const person = {
      firstName: 'Ada',
      lastName: 'Privacy',
      annualCtc: 987654,
      hireDate: new Date('2020-01-01'),
      dateOfBirth: new Date('1990-01-01'),
      status: 'Active',
      lifecycleVersion: 0,
    };
    await db.collection('org800001_employees').insertMany([
      { ...person, _id: id, email: 'private@example.test' },
      { ...person, _id: peer, email: 'peer@example.test' },
    ]);
    await db.collection('org800001_employees').updateOne({ _id: id }, { $set: { incomeTaxProfile: { regime: 'private-regime' } } });
    await db.collection('org800001_employee_tax_profiles').insertOne({ organizationId: org, employeeId: String(id), yearCode: '2026-27', version: 1, regime: 'new', tdsApplicable: false, reason: 'Private saved profile' });
    const hash = await hashPassword(password);
    employeeAccount = await users.create({
      email: 'private@example.test',
      firstName: 'Ada',
      role: 'employee',
      organizationId: org,
      employeeRecordId: String(id),
      employeeLifecycleVersion: 0,
      passwordHash: hash,
      active: true,
      invitationPending: false,
    });
    await users.create({
      email: 'peer@example.test',
      role: 'employee',
      organizationId: org,
      employeeRecordId: String(peer),
      employeeLifecycleVersion: 0,
      passwordHash: hash,
      active: true,
    });
    for (const role of ['admin', 'user'])
      await users.create({
        email: `${role}@example.test`,
        role,
        organizationId: org,
        passwordHash: hash,
        active: true,
      });
    await db
      .collection('org800001_payroll_runs')
      .insertOne({
        organizationId: org,
        period: '2026-10',
        status: 'Submitted',
        checks: [
          {
            employeeId: String(id),
            firstName: 'Ada',
            annualCtc: 987654,
            grossPay: 87654,
            employerContributions: 1234,
            deductions: 3456,
            netPay: 84198,
            tds: 456,
            tax: { privateTaxProfile: { regime: 'private-regime' } },
            calculation: { taxSnapshot: { regime: 'private-regime' } },
            snapshot: { hiddenFinancial: 987654 },
            pdf: Buffer.from('%PDF-sensitive').toString('base64'),
          },
        ],
      });
    cookie = await login('private@example.test');
    otherSession = await login('private@example.test');
    peerCookie = await login('peer@example.test');
    adminCookie = await login('admin@example.test');
    userCookie = await login('user@example.test');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await client?.close();
    if (mongo?.exitCode === null) {
      const stopped = new Promise((r) => mongo.once('exit', r));
      mongo.kill();
      await stopped;
    }
  }, 20000);
  beforeEach(async () => {
    failMail = false;
    await clearLimits();
    await post('lock').expect(201);
  });

  it('defaults ON and omits every compensation/snapshot field, while preserving non-sensitive data', async () => {
    const own = await profile().expect(200);
    expect(own.body.firstName).toBe('Ada');
    expect(own.body.annualCtc).toBeNull();
    expect(own.body.privateMode).toBe(true);
    const checks = await request(app.getHttpServer())
      .get(`/payroll/employees/${id}/checks?privateMode=false`)
      .set('Cookie', cookie)
      .expect(200);
    expect(checks.body[0]).toMatchObject({
      period: '2026-10',
      paymentStatus: 'Payment Pending',
      grossPay: null,
      deductions: null,
      employerContributions: null,
      netPay: null,
    });
    expect(checks.body[0].tds).toBeNull();
    expect(checks.body[0].annualCtc).toBeUndefined();
    expect(checks.body[0].monthlyCtc).toBeUndefined();
    expect(checks.body[0].snapshot).toBeUndefined();
    expect(checks.body[0].pdfUrl).toBeUndefined();
    await request(app.getHttpServer())
      .get(`/employees/${id}/income-tax`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/payroll/runs/2026-10/checks/${id}/pdf`)
      .set('Cookie', cookie)
      .expect(403);
    const stored = await db
      .collection('org800001_employees')
      .findOne({ _id: id });
    expect(stored?.annualCtc).toBe(987654);
  });
  it('emails a six-digit code, stores only a keyed digest and unlocks the same session once', async () => {
    const sent = await post('request').expect(201);
    const otp = code();
    expect(sent.body.maskedEmail).not.toBe('private@example.test');
    expect(JSON.stringify(sent.body)).not.toContain(otp);
    expect(messages.at(-1)!.content.subject).toContain(
      'Private Mode Verification Code',
    );
    expect(messages.at(-1)!.content.text).not.toContain('987654');
    const stored = await db
      .collection('employee_private_mode_challenges')
      .findOne({ accountId: employeeAccount.id, delivered: true });
    expect(stored?.otpHash).toMatch(/^[a-f\d]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(otp);
    const verified = await post('verify', { code: otp }).expect(201);
    expect(verified.body.privateMode).toBe(false);
    expect(verified.body.unlockedUntil).toBeGreaterThan(Date.now());
    expect((await profile().expect(200)).body.annualCtc).toBe(987654);
    expect((await profile(otherSession).expect(200)).body.annualCtc).toBeNull();
    await post('verify', { code: otp }).expect(400);
    const checks = await request(app.getHttpServer())
      .get(`/payroll/employees/${id}/checks`)
      .set('Cookie', cookie)
      .expect(200);
    expect(checks.body[0].grossPay).toBe(87654);
    await request(app.getHttpServer())
      .get(`/payroll/runs/2026-10/checks/${id}/pdf`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/payroll/employees/${peer}/checks`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/employee-portal/private-mode')
      .set('Cookie', cookie)
      .expect(200)
      .expect((r) => expect(r.body.privateMode).toBe(false));
  });
  it('rejects invalid, expired and reused codes and caps incorrect attempts', async () => {
    await post('request').expect(201);
    const valid = code(),
      wrong = valid === '000000' ? '111111' : '000000';
    for (let n = 0; n < 4; n++)
      await post('verify', { code: wrong }).expect(400);
    await post('verify', { code: wrong }).expect(429);
    await post('verify', { code: valid }).expect(429);
    expect((await profile()).body.annualCtc).toBeNull();
    await clearLimits();
    await post('request').expect(201);
    const fresh = code();
    await db
      .collection('employee_private_mode_challenges')
      .updateMany(
        { accountId: employeeAccount.id },
        { $set: { otpExpiresAt: new Date(0) } },
      );
    await post('verify', { code: fresh }).expect(400);
  });
  it('enforces cooldown and per-account rate limits, and invalidates the previous code on resend', async () => {
    await post('request').expect(201);
    const old = code();
    await post('request').expect(429);
    await db
      .collection('employee_private_mode_limits')
      .updateOne(
        { _id: `${employeeAccount.id}:cooldown` },
        { $set: { availableAt: new Date(0) } },
      );
    await post('request').expect(201);
    const fresh = code();
    expect(old).not.toBe(fresh);
    await post('verify', { code: old }).expect(400);
    await post('verify', { code: fresh }, otherSession).expect(400);
    await post('verify', { code: fresh }, peerCookie).expect(400);
    for (let n = 0; n < 4; n++) await post('request').expect(429);
  });
  it('locks immediately, automatically expires grants, and a new login cannot reuse them', async () => {
    await post('request').expect(201);
    await post('verify', { code: code() }).expect(201);
    await post('lock').expect(201);
    expect((await profile()).body.annualCtc).toBeNull();
    await clearLimits();
    await post('request').expect(201);
    await post('verify', { code: code() }).expect(201);
    const newSession = await login('private@example.test');
    expect((await profile(newSession)).body.annualCtc).toBeNull();
    await db
      .collection('employee_private_mode_challenges')
      .updateMany(
        { accountId: employeeAccount.id },
        { $set: { grantExpiresAt: new Date(0) } },
      );
    expect((await profile()).body.annualCtc).toBeNull();
    await request(app.getHttpServer())
      .get(`/payroll/runs/2026-10/checks/${id}/pdf`)
      .set('Cookie', cookie)
      .expect(403);
  });
  it('does not grant access on mail failure or accept payload-selected identities', async () => {
    failMail = true;
    await post('request').expect(503);
    expect((await profile()).body.annualCtc).toBeNull();
    expect(
      await db
        .collection('employee_private_mode_challenges')
        .countDocuments({
          accountId: employeeAccount.id,
          otpHash: { $exists: true },
        }),
    ).toBe(0);
    await post('verify', { code: '123456', employeeId: String(peer) }).expect(
      400,
    );
    for (const sessionCookie of [adminCookie, userCookie])
      await post('request', {}, sessionCookie).expect(403);
  });
  it('preserves administrator/user values and PDFs without any OTP requirement', async () => {
    for (const staffCookie of [adminCookie, userCookie]) {
      const employees = await request(app.getHttpServer())
        .get('/employees')
        .set('Cookie', staffCookie)
        .expect(200);
      expect(employees.body.find((e) => e._id === String(id)).annualCtc).toBe(
        987654,
      );
      const checks = await request(app.getHttpServer())
        .get(`/payroll/employees/${id}/checks`)
        .set('Cookie', staffCookie)
        .expect(200);
      expect(checks.body[0].grossPay).toBe(87654);
      await request(app.getHttpServer())
        .get(`/payroll/runs/2026-10/checks/${id}/pdf`)
        .set('Cookie', staffCookie)
        .expect(200);
    }
  });
  it('denies all employee tax endpoints with and without OTP unlock and retains existing staff/organization permissions', async () => {
    const foreign = new Types.ObjectId();
    await db.collection('org800002_employees').insertOne({ _id: foreign, firstName: 'Other organization', email: 'foreign@example.test', status: 'Active', annualCtc: 123000 });
    await db.collection('org800002_employee_tax_profiles').insertOne({ organizationId: 'ORG800002', employeeId: String(foreign), yearCode: '2026-27', version: 1, regime: 'old', tdsApplicable: false });
    for (const unlocked of [false, true]) {
      if (unlocked) { await post('request').expect(201); await post('verify', { code: code() }).expect(201); }
      for (const target of [id, peer, foreign]) {
        for (const suffix of ['', '/2026-27', '/2026-27/history']) await request(app.getHttpServer()).get(`/employees/${target}/income-tax${suffix}`).set('Cookie', cookie).expect(403);
        await request(app.getHttpServer()).put(`/employees/${target}/income-tax/2026-27`).set(headers).set('Cookie', cookie).send({}).expect(403);
        for (const action of ['edit', 'calculate', 'change-year']) await request(app.getHttpServer()).post(`/employees/${target}/income-tax/2026-27/${action}`).set(headers).set('Cookie', cookie).send({}).expect(403);
      }
      const details = await profile().expect(200); expect(details.body.firstName).toBe('Ada'); expect(details.body.incomeTaxProfile).toBeUndefined();
      const checks = await request(app.getHttpServer()).get(`/payroll/employees/${id}/checks`).set('Cookie', cookie).expect(200);
      expect(checks.body[0].tax).toBeUndefined(); expect(checks.body[0].calculation).toBeUndefined(); expect(checks.body[0].snapshot).toBeUndefined();
      if (unlocked) { expect(details.body.annualCtc).toBe(987654); expect(checks.body[0].grossPay).toBe(87654); expect(checks.body[0].tds).toBe(456); }
    }
    for (const suffix of ['', '/2026-27', '/2026-27/history']) {
      await request(app.getHttpServer()).get(`/employees/${id}/income-tax${suffix}`).set('Cookie', adminCookie).expect(200);
      // The existing regular-user role does not have dedicated tax permissions. Do not expand it.
      await request(app.getHttpServer()).get(`/employees/${id}/income-tax${suffix}`).set('Cookie', userCookie).expect(403);
      await request(app.getHttpServer()).get(`/employees/${foreign}/income-tax${suffix}`).set('Cookie', adminCookie).expect(404);
    }
    const staffChecks = await request(app.getHttpServer()).get(`/payroll/employees/${id}/checks`).set('Cookie', adminCookie).expect(200);
    expect(staffChecks.body[0].tax.privateTaxProfile.regime).toBe('private-regime');
  });
  it('rejects revoked sessions and logout destroys the temporary authorization context', async () => {
    await post('request').expect(201);
    await post('verify', { code: code() }).expect(201);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${id}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: false })
      .expect(200);
    await profile().expect(401);
    await post('verify', { code: code() }).expect(401);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${id}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: true })
      .expect(200);
    cookie = await login('private@example.test');
    expect((await profile()).body.annualCtc).toBeNull();
    await clearLimits();
    await post('request').expect(201);
    await post('verify', { code: code() }).expect(201);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set(headers)
      .set('Cookie', cookie)
      .send({})
      .expect(204);
    await profile().expect(401);
    cookie = await login('private@example.test');
    expect((await profile()).body.annualCtc).toBeNull();
  });
});
