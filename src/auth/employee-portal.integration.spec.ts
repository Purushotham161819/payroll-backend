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
import { createHash, randomBytes } from 'node:crypto';
import session from 'express-session';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { EmailService } from './email.service';
import { InvitationMail } from './invitation-mail';
import { User } from './auth.schema';
import { hashPassword } from './password-hashing';
import { configureSecurity } from './http-security';
import { EmployeesModule } from '../employees/employees.module';
import { RunPayrollModule } from '../run-payroll/run-payroll.module';
import { employeeRequestAllowed } from './employee-access';
import { PasswordResetService } from './password-reset.service';

describe('Employee portal (isolated, targeted security integration)', () => {
  let app: NestExpressApplication,
    db: Connection,
    users: Model<User>,
    mongo: ChildProcess,
    client: MongoClient;
  let adminCookie: string,
    employeeCookie: string,
    employeeAccount: any,
    employeeToken: string;
  const own = new Types.ObjectId(),
    peer = new Types.ObjectId(),
    foreign = new Types.ObjectId();
  const org = 'ORG900001',
    otherOrg = 'ORG900002';
  const headers = { Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' };
  const password = 'employee-test-password';
  const messages: { to: string; url: string; employee: boolean }[] = [];
  let failMail = false;
  const recoveryMail: any[] = [];
  const mail = {
    send: jest.fn(
      async (
        to: string,
        _first: string,
        _last: string,
        url: string,
        _hours: number,
        employee: boolean,
      ) => {
        if (failMail) throw new Error('Controlled delivery failure');
        messages.push({ to, url, employee });
      },
    ),
  };
  const login = async (email: string) => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email, password })
      .expect(200);
    return result.headers['set-cookie'][0].split(';')[0];
  };
  beforeAll(async () => {
    const socket = createServer();
    await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r));
    const port = (socket.address() as any).port;
    await new Promise<void>((r) => socket.close(() => r()));
    const dir = mkdtempSync(join(tmpdir(), 'paystream-employee-portal-'));
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
    for (let i = 0; i < 40; i++) {
      try {
        await client.connect();
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!ready) throw new Error('Isolated MongoDB did not start');
    process.env.FRONTEND_ORIGIN = headers.Origin;
    process.env.SESSION_SECRET = randomBytes(48).toString('hex');
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(
          `mongodb://127.0.0.1:${port}/employee_portal_test`,
        ),
        AuthModule,
        EmployeesModule,
        RunPayrollModule,
      ],
    })
      .overrideProvider(InvitationMail)
      .useValue(mail)
      .overrideProvider(EmailService)
      .useValue({
        send: jest.fn(async (_to, content) => {
          recoveryMail.push(content);
        }),
        passwordChanged: jest.fn(),
      })
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
    await db.collection('organizations').insertMany([
      {
        organizationId: org,
        status: 'active',
        name: 'Employee A',
        normalizedName: 'employee a',
      },
      {
        organizationId: otherOrg,
        status: 'active',
        name: 'Employee B',
        normalizedName: 'employee b',
      },
    ]);
    const person = {
      firstName: 'Ada',
      lastName: 'Example',
      status: 'Active',
      lifecycleVersion: 0,
      hireDate: new Date('2020-01-01'),
      dateOfBirth: new Date('1990-01-01'),
      annualCtc: 120000,
      payFrequency: 'Monthly',
    };
    await db.collection('org900001_employees').insertMany([
      { ...person, _id: own, email: 'employee@example.test' },
      { ...person, _id: peer, email: 'peer@example.test' },
    ]);
    await db
      .collection('org900002_employees')
      .insertOne({ ...person, _id: foreign, email: 'foreign@example.test' });
    await users.create({
      email: 'admin@example.test',
      role: 'admin',
      active: true,
      organizationId: org,
      passwordHash: await hashPassword(password),
    });
    adminCookie = await login('admin@example.test');
    await db.collection('org900001_payroll_runs').insertOne({
      organizationId: org,
      period: '2026-10',
      status: 'Submitted',
      checks: [
        {
          employeeId: own.toHexString(),
          firstName: 'Ada',
          annualCtc: 120000,
          gross: 10000,
          net: 9000,
          pdf: Buffer.from('%PDF-own').toString('base64'),
        },
        {
          employeeId: peer.toHexString(),
          firstName: 'Private Peer',
          annualCtc: 240000,
          gross: 20000,
          net: 18000,
          pdf: Buffer.from('%PDF-peer').toString('base64'),
        },
      ],
    });
    await db.collection('org900001_employee_tax_profiles').insertOne({
      organizationId: org,
      employeeId: own.toHexString(),
      yearCode: '2026-27',
      version: 1,
      regime: 'new',
      tdsApplicable: false,
      reason: 'Saved administrator decision',
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await client?.close();
    if (mongo?.exitCode === null) {
      const closed = new Promise((r) => mongo.once('exit', r));
      mongo.kill();
      await closed;
    }
  }, 20000);

  it('invites through the existing mail flow, stores only a hash, activates once and logs in with employee identity', async () => {
    await request(app.getHttpServer())
      .post(`/employee-accounts/${own}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(201);
    const sent = messages.at(-1)!;
    expect(sent.employee).toBe(true);
    expect(sent.to).toBe('employee@example.test');
    employeeToken = new URL(sent.url).hash.slice('#token='.length);
    employeeAccount = await users
      .findOne({ email: sent.to })
      .select('+invitationHash +passwordHash');
    expect(employeeAccount.role).toBe('employee');
    expect(employeeAccount.employeeRecordId).toBe(String(own));
    expect(employeeAccount.invitationHash).toBe(
      createHash('sha256').update(employeeToken).digest('hex'),
    );
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: sent.to, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/invitation/inspect')
      .set(headers)
      .send({ token: employeeToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/invitation/complete')
      .set(headers)
      .send({ token: employeeToken, password, confirmation: password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/invitation/inspect')
      .set(headers)
      .send({ token: employeeToken })
      .expect(400);
    employeeCookie = await login(sent.to);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', employeeCookie)
      .expect(200);
    expect(me.body).toMatchObject({
      role: 'employee',
      organizationId: org,
      employeeRecordId: String(own),
      firstName: 'Ada',
    });
    expect(me.body.passwordHash).toBeUndefined();
  });
  it('returns the linked profile and own checks/PDF but rejects the dedicated tax APIs even after unlock', async () => {
    await request(app.getHttpServer()).post('/employee-portal/private-mode/request').set(headers).set('Cookie', employeeCookie).send({}).expect(201);
    const otp = /code is: (\d{6})/.exec(recoveryMail.at(-1).text)![1];
    await request(app.getHttpServer()).post('/employee-portal/private-mode/verify').set(headers).set('Cookie', employeeCookie).send({ code: otp }).expect(201);
    const profile = await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(200);
    expect(profile.body._id).toBe(String(own));
    await request(app.getHttpServer())
      .get(`/employees/${own}/income-tax`)
      .set('Cookie', employeeCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/employees/${own}/income-tax/2026-27`)
      .set('Cookie', employeeCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/employees/${own}/income-tax/2026-27/history`)
      .set('Cookie', employeeCookie)
      .expect(403);
    const history = await request(app.getHttpServer())
      .get(`/payroll/employees/${own}/checks`)
      .set('Cookie', employeeCookie)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].employeeId).toBe(String(own));
    expect(JSON.stringify(history.body)).not.toContain('Private Peer');
    await request(app.getHttpServer())
      .get(`/payroll/runs/2026-10/checks/${own}/pdf`)
      .set('Cookie', employeeCookie)
      .expect(200)
      .expect('Content-Type', /pdf/);
  });
  it('rejects peer/foreign records, bulk data, admin APIs and direct mutation calls', async () => {
    for (const id of [peer, foreign])
      for (const path of [
        `/employees/${id}/income-tax`,
        `/employees/${id}/income-tax/2026-27`,
        `/payroll/employees/${id}/checks`,
        `/payroll/runs/2026-10/checks/${id}/pdf`,
      ])
        await request(app.getHttpServer())
          .get(path)
          .set('Cookie', employeeCookie)
          .expect(403);
    for (const path of [
      '/employees',
      '/users',
      '/settings/tax-configuration',
      '/payroll/runs/2026-10',
    ])
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', employeeCookie)
        .expect(403);
    for (const path of [
      `/employee-accounts/${peer}/invitation`,
      '/payroll/runs/preview',
      `/payroll/runs/2026-10/checks/${own}/paid`,
      `/employees/${own}/income-tax/2026-27/calculate`,
    ])
      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Cookie', employeeCookie)
        .send({})
        .expect(403);
    await request(app.getHttpServer())
      .patch(`/employees/${own}`)
      .set(headers)
      .set('Cookie', employeeCookie)
      .send({ annualCtc: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/employees/${own}/income-tax/2026-27`)
      .set(headers)
      .set('Cookie', employeeCookie)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .expect(401);
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', adminCookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${foreign}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(404);
  });
  it('keeps active accounts unique, rejects expired/invalid tokens and allows controlled pending resend', async () => {
    const active = await request(app.getHttpServer())
      .post(`/employee-accounts/${own}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(active.body.alreadyActive).toBe(true);
    expect(await users.countDocuments({ employeeRecordId: String(own) })).toBe(
      1,
    );
    await request(app.getHttpServer())
      .post(`/employee-accounts/${peer}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(201);
    const old = new URL(messages.at(-1)!.url).hash.slice(7);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${peer}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(409);
    await users.updateOne(
      { email: 'peer@example.test' },
      {
        $set: {
          invitationExpiresAt: new Date(0),
          invitationSentAt: new Date(0),
        },
      },
    );
    await request(app.getHttpServer())
      .post('/auth/invitation/inspect')
      .set(headers)
      .send({ token: old })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${peer}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(await users.countDocuments({ employeeRecordId: String(peer) })).toBe(
      1,
    );
    await request(app.getHttpServer())
      .post('/auth/invitation/inspect')
      .set(headers)
      .send({ token: randomBytes(32).toString('base64url') })
      .expect(400);
  });
  it('blocks email changes, termination, rehire until explicit enable, deactivation and inactive organizations', async () => {
    const employees = db.collection('org900001_employees');
    await employees.updateOne(
      { _id: own },
      { $set: { email: 'changed@example.test' } },
    );
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(401);
    await employees.updateOne(
      { _id: own },
      {
        $set: {
          email: 'employee@example.test',
          status: 'Terminated',
          lifecycleVersion: 1,
        },
      },
    );
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(401);
    await employees.updateOne(
      { _id: own },
      { $set: { status: 'Active', lifecycleVersion: 2 } },
    );
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${own}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: true })
      .expect(200);
    employeeCookie = await login('employee@example.test');
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${own}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(401);
    expect(await employees.countDocuments({ _id: own })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${own}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: true })
      .expect(200);
    employeeCookie = await login('employee@example.test');
    await db
      .collection('organizations')
      .updateOne({ organizationId: org }, { $set: { status: 'inactive' } });
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(401);
    await db
      .collection('organizations')
      .updateOne({ organizationId: org }, { $set: { status: 'active' } });
  });
  it('reuses password recovery for employees, consumes reset links once and invalidates old sessions', async () => {
    await app.get(PasswordResetService).request('employee@example.test');
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(
      recoveryMail.at(-1).text,
    )![1];
    await request(app.getHttpServer())
      .post('/auth/reset-password/inspect')
      .set(headers)
      .send({ token })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/reset-password/complete')
      .set(headers)
      .send({ token, password, confirmation: password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/reset-password/inspect')
      .set(headers)
      .send({ token })
      .expect(400);
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(401);
    employeeCookie = await login('employee@example.test');
    await request(app.getHttpServer())
      .get('/employee-portal/profile')
      .set('Cookie', employeeCookie)
      .expect(200);
  });
  it('rejects invalid employee emails and duplicate login emails, and preserves failed invitations for retry', async () => {
    const employees = db.collection('org900001_employees');
    const id = new Types.ObjectId();
    await employees.insertOne({
      _id: id,
      firstName: 'Test',
      lastName: 'Invite',
      status: 'Active',
      lifecycleVersion: 0,
      email: '',
    });
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(400);
    await employees.updateOne(
      { _id: id },
      { $set: { email: 'admin@example.test' } },
    );
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .expect(409);
    await employees.updateOne(
      { _id: id },
      { $set: { email: 'failed@example.test' } },
    );
    failMail = true;
    try {
      const result = await request(app.getHttpServer())
        .post(`/employee-accounts/${id}/invitation`)
        .set(headers)
        .set('Cookie', adminCookie)
        .expect(201);
      expect(result.body.invitationSent).toBe(false);
      const account = await users
        .findOne({ email: 'failed@example.test' })
        .select('+invitationHash');
      expect(account?.invitationDelivery).toBe('failed');
      expect(account?.invitationHash).toBeUndefined();
      expect(account?.invitationPending).toBe(true);
      const failed = await request(app.getHttpServer())
        .get(`/employee-accounts/${id}/permissions`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(failed.body.invitationStatus).toBe('Delivery Failed');
      expect(failed.body.invitationSentAt).toBeNull();
    } finally {
      failMail = false;
    }
  });
  it('allowlists reads only, rejecting alternate IDs and all mutations', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(
        employeeRequestAllowed(
          method,
          `/employees/${own}/income-tax`,
          String(own),
        ),
      ).toBe(false);
    expect(
      employeeRequestAllowed(
        'GET',
        `/payroll/runs/2026-10/checks/${peer}/pdf`,
        String(own),
      ),
    ).toBe(false);
  });
  it('reports real activation/login dates without secrets and does not update login on failure or session probes', async () => {
    const before = await request(app.getHttpServer())
      .get(`/employee-accounts/${own}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(before.body.accountStatus).toBe('Account Active');
    expect(before.body.invitationAcceptedAt).toBeTruthy();
    expect(before.body.accountActivatedAt).toBeTruthy();
    expect(before.body.passwordSetupAt).toBe(before.body.accountActivatedAt);
    expect(before.body.lastLoginAt).toBeTruthy();
    expect(before.body.invitationSentAt).toBeTruthy();
    expect(before.body.audit.some((e) => e.action === 'login.succeeded')).toBe(
      true,
    );
    for (const key of [
      'passwordHash',
      'invitationHash',
      'resetHash',
      'sessionVersion',
    ])
      expect(before.body[key]).toBeUndefined();
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: 'employee@example.test', password: 'wrong-password' })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', employeeCookie)
      .expect(200);
    const after = await request(app.getHttpServer())
      .get(`/employee-accounts/${own}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(after.body.lastLoginAt).toBe(before.body.lastLoginAt);
    employeeCookie = await login('employee@example.test');
    const loggedIn = await request(app.getHttpServer())
      .get(`/employee-accounts/${own}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(new Date(loggedIn.body.lastLoginAt).getTime()).toBeGreaterThan(
      new Date(before.body.lastLoginAt).getTime(),
    );
  });
  it('shows Not Invited and unavailable historical login/activation dates without inventing them', async () => {
    const id = new Types.ObjectId();
    const email = 'legacy-permissions@example.test';
    await db
      .collection('org900001_employees')
      .insertOne({
        _id: id,
        email,
        firstName: 'Historical',
        status: 'Active',
        lifecycleVersion: 0,
      });
    const uninvited = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(uninvited.body.accountStatus).toBe('Not Invited');
    expect(uninvited.body.lastLoginAt).toBeNull();
    await users.create({
      email,
      role: 'employee',
      organizationId: org,
      employeeRecordId: String(id),
      employeeLifecycleVersion: 0,
      active: true,
      invitationPending: false,
      passwordHash: await hashPassword(password),
    });
    const legacy = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(legacy.body.loginStatus).toBe('Not Available');
    expect(legacy.body.accountActivatedAt).toBeNull();
    expect(legacy.body.invitationAcceptedAt).toBeNull();
  });
  it('cancels and resends invitations on the existing account, invalidating old tokens and tracking expiry', async () => {
    const id = new Types.ObjectId();
    const email = 'cancel-permissions@example.test';
    await db
      .collection('org900001_employees')
      .insertOne({
        _id: id,
        email,
        firstName: 'Cancel',
        status: 'Active',
        lifecycleVersion: 0,
      });
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
    const oldToken = new URL(messages.at(-1)!.url).hash.slice(7);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation/cancel`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/invitation/complete')
      .set(headers)
      .send({ token: oldToken, password, confirmation: password })
      .expect(400);
    const cancelled = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(cancelled.body.invitationStatus).toBe('Invitation Cancelled');
    expect(cancelled.body.canCancel).toBe(false);
    expect(cancelled.body.invitationCancelledAt).toBeTruthy();
    await users.updateOne(
      { email },
      { $set: { invitationSentAt: new Date(0) } },
    );
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation/resend`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
    const token = new URL(messages.at(-1)!.url).hash.slice(7);
    expect(token).not.toBe(oldToken);
    expect(await users.countDocuments({ email })).toBe(1);
    const resent = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(resent.body.invitationStatus).toBe('Invitation Sent');
    expect(resent.body.invitationCancelledAt).toBeNull();
    expect(
      resent.body.audit.some((e) => e.action === 'invitation.resent'),
    ).toBe(true);
    await users.updateOne(
      { email },
      { $set: { invitationExpiresAt: new Date(0) } },
    );
    const expired = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(expired.body.invitationStatus).toBe('Invitation Expired');
    // Validate expired tokens directly to keep the shared public-route throttle outside this focused case.
    await expect(
      app
        .get((await import('./invitations.service')).InvitationsService)
        .inspect(token),
    ).rejects.toThrow();
  });
  it('records setup independently from first login, revokes immediately, and restores without sending invitations', async () => {
    const id = new Types.ObjectId(),
      email = 'lifecycle-permissions@example.test';
    await db
      .collection('org900001_employees')
      .insertOne({
        _id: id,
        email,
        firstName: 'Lifecycle',
        status: 'Active',
        lifecycleVersion: 0,
      });
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
    const token = new URL(messages.at(-1)!.url).hash.slice(7);
    await app
      .get((await import('./invitations.service')).InvitationsService)
      .complete(token, password, password);
    const setup = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(setup.body.invitationStatus).toBe('Invitation Accepted');
    expect(setup.body.passwordSetupStatus).toBe('Completed');
    expect(setup.body.loginStatus).toBe('Never Logged In');
    expect(setup.body.lastLoginAt).toBeNull();
    // Service auth avoids unrelated rate-limit exhaustion; controller/session recording is covered above.
    const auth = app.get((await import('./auth.service')).AuthService);
    const loginResult = await auth.login(email, password);
    await auth.recordEmployeeLogin(loginResult.id, loginResult.sessionVersion);
    const sentCount = messages.length;
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${id}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: false })
      .expect(200);
    await expect(auth.login(email, password)).rejects.toThrow();
    await expect(
      auth.current(loginResult.id, loginResult.sessionVersion),
    ).rejects.toThrow();
    const revoked = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(revoked.body.accessStatus).toBe('Access Revoked');
    expect(revoked.body.canRestore).toBe(true);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${id}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: true })
      .expect(200);
    const restored = await request(app.getHttpServer())
      .get(`/employee-accounts/${id}/permissions`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(restored.body.lastLoginAt).toBe(revoked.body.lastLoginAt);
    expect(restored.body.accountActivatedAt).toBe(
      setup.body.accountActivatedAt,
    );
    expect(restored.body.accessRestoredAt).toBeTruthy();
    expect(messages).toHaveLength(sentCount);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation/cancel`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation/resend`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(409);
  });
  it('allows employee managers to view/revoke/cancel/resend, reserves restore for admins, and enforces organization ownership', async () => {
    const manager = await users.create({
      email: 'manager-permissions@example.test',
      role: 'user',
      active: true,
      organizationId: org,
      passwordHash: await hashPassword(password),
    });
    // Reuse an existing session container with the manager identity to avoid testing login throttling here.
    const managerCookie = await login(manager.email);
    await request(app.getHttpServer())
      .get(`/employee-accounts/${own}/permissions`)
      .set('Cookie', managerCookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${peer}/invitation/cancel`)
      .set(headers)
      .set('Cookie', managerCookie)
      .send({})
      .expect(201);
    await users.updateOne(
      { employeeRecordId: String(peer) },
      { $set: { invitationSentAt: new Date(0) } },
    );
    await request(app.getHttpServer())
      .post(`/employee-accounts/${peer}/invitation/resend`)
      .set(headers)
      .set('Cookie', managerCookie)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${own}/status`)
      .set(headers)
      .set('Cookie', managerCookie)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${own}/status`)
      .set(headers)
      .set('Cookie', managerCookie)
      .send({ active: true })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/employee-accounts/${own}/status`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ active: true })
      .expect(200);
    for (const cookie of [managerCookie, adminCookie]) {
      await request(app.getHttpServer())
        .get(`/employee-accounts/${foreign}/permissions`)
        .set('Cookie', cookie)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/employee-accounts/${foreign}/invitation/cancel`)
        .set(headers)
        .set('Cookie', cookie)
        .send({})
        .expect(404);
      await request(app.getHttpServer())
        .post(`/employee-accounts/${foreign}/invitation/resend`)
        .set(headers)
        .set('Cookie', cookie)
        .send({})
        .expect(404);
    }
    // Get a fresh employee session because revoke/restore correctly invalidated the previous one.
    employeeCookie = await login('employee@example.test');
    await request(app.getHttpServer())
      .get(`/employee-accounts/${own}/permissions`)
      .set('Cookie', employeeCookie)
      .expect(403);
    for (const active of [true, false]) await request(app.getHttpServer()).patch(`/employee-accounts/${own}/status`).set(headers).set('Cookie', employeeCookie).send({ active }).expect(403);
    for (const action of ['cancel', 'resend'])
      await request(app.getHttpServer())
        .post(`/employee-accounts/${own}/invitation/${action}`)
        .set(headers)
        .set('Cookie', employeeCookie)
        .send({})
        .expect(403);
  });
  it('requires explicit confirmation before converting a same-organization pending user and sends a fresh employee invitation', async () => {
    const id = new Types.ObjectId();
    const email = 'pending-employee@example.test';
    await db.collection('org900001_employees').insertOne({
      _id: id,
      email,
      firstName: 'Pending',
      lastName: 'Employee',
      status: 'Active',
      lifecycleVersion: 0,
    });
    const oldToken = randomBytes(32).toString('base64url');
    const account = await users.create({
      email,
      organizationId: org,
      role: 'user',
      active: true,
      invitationPending: true,
      invitationDelivery: 'sent',
      invitationHash: createHash('sha256').update(oldToken).digest('hex'),
      invitationExpiresAt: new Date(Date.now() + 3600000),
      passwordHash: await hashPassword(password),
    });
    const count = messages.length;
    const conflict = await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({})
      .expect(409);
    expect(conflict.body).toMatchObject({
      code: 'PENDING_USER_LINK_CONFIRMATION_REQUIRED',
      pendingAccountId: account.id,
    });
    expect(messages).toHaveLength(count);
    expect((await users.findById(account.id))?.role).toBe('user');
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ linkPendingUserId: new Types.ObjectId().toString() })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/employee-accounts/${id}/invitation`)
      .set(headers)
      .set('Cookie', adminCookie)
      .send({ linkPendingUserId: account.id })
      .expect(201);
    const converted = await users
      .findById(account.id)
      .select('+sessionVersion');
    expect(converted).toMatchObject({
      role: 'employee',
      employeeRecordId: String(id),
      employeeLifecycleVersion: 0,
      invitationPending: true,
      sessionVersion: 1,
    });
    expect(await users.countDocuments({ email })).toBe(1);
    expect(messages).toHaveLength(count + 1);
    expect(messages.at(-1)?.employee).toBe(true);
    await request(app.getHttpServer())
      .post('/auth/invitation/inspect')
      .set(headers)
      .send({ token: oldToken })
      .expect(400);
  });
  it('never converts active, administrator, disabled, cross-organization or already-linked accounts', async () => {
    const cases = [
      {
        role: 'user',
        active: true,
        invitationPending: false,
        organizationId: org,
      },
      {
        role: 'admin',
        active: true,
        invitationPending: true,
        organizationId: org,
      },
      {
        role: 'user',
        active: false,
        invitationPending: true,
        organizationId: org,
      },
      {
        role: 'user',
        active: true,
        invitationPending: true,
        organizationId: otherOrg,
      },
      {
        role: 'user',
        active: true,
        invitationPending: true,
        organizationId: org,
        employeeRecordId: new Types.ObjectId().toString(),
      },
    ];
    const count = messages.length;
    for (const [index, fields] of cases.entries()) {
      const id = new Types.ObjectId(),
        email = `protected-${index}@example.test`;
      await db
        .collection('org900001_employees')
        .insertOne({ _id: id, email, status: 'Active', lifecycleVersion: 0 });
      const account = await users.create({
        ...fields,
        email,
        passwordHash: await hashPassword(password),
      });
      await request(app.getHttpServer())
        .post(`/employee-accounts/${id}/invitation`)
        .set(headers)
        .set('Cookie', adminCookie)
        .send({ linkPendingUserId: account.id })
        .expect(409);
      const unchanged = await users.findById(account.id);
      expect(unchanged?.role).toBe(fields.role);
      expect(unchanged?.employeeRecordId).toBe(fields.employeeRecordId);
    }
    expect(messages).toHaveLength(count);
  });
});
