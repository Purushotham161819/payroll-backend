import { EmailService } from './email.service';
import { PasswordResetService } from './password-reset.service';
import { PlatformService } from '../organizations/platform.service';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Connection, Model } from 'mongoose';
import { MongoClient } from 'mongodb';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import session from 'express-session';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { User } from './auth.schema';
import { UsersService } from './users.service';
import { InvitationsService } from './invitations.service';
import { InvitationMail, invitationEmail } from './invitation-mail';
import { configureSecurity } from './http-security';
import { hashPassword } from './password-hashing';

// Isolated Mongo process and controlled email mock; no live recipients or customer DB.
describe('User invitation and password setup (focused integration)', () => {
  let app: NestExpressApplication,
    db: Connection,
    users: Model<User>,
    mongo: ChildProcess,
    client: MongoClient;
  let admin: any,
    other: any,
    cookie: string,
    service: UsersService,
    invitations: InvitationsService;
  const messages: {
    to: string;
    first: string;
    last: string;
    url: string;
    hours: number;
  }[] = [];
  const resetMessages: { to: string; content: any }[] = [];
  const emailMock = {
    send: jest.fn(async (to: string, content: any) => {
      resetMessages.push({ to, content });
      return { status: 'accepted' };
    }),
    passwordChanged: jest.fn(async () => {}),
  };
  let failEmail = false;
  const org = 'ORG_INVITE_A',
    otherOrg = 'ORG_INVITE_B';
  const password = 'initial-test-password';
  const headers = { Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' };
  const mail = {
    send: jest.fn(
      async (
        to: string,
        first: string,
        last: string,
        url: string,
        hours: number,
      ) => {
        if (failEmail) throw new Error('SMTP unavailable');
        messages.push({ to, first, last, url, hours });
      },
    ),
  };
  const tokenFor = (email: string) =>
    new URL(messages.filter((m) => m.to === email).at(-1)!.url).hash.slice(
      '#token='.length,
    );
  const create = async (extra: object = {}) =>
    service.create(admin.id, 0, {
      firstName: 'Asha',
      lastName: 'Rao',
      email: randomUUID() + '@example.test',
      role: 'user',
      active: true,
      ...extra,
    });
  beforeAll(async () => {
    const portServer = createServer();
    await new Promise<void>((r) => portServer.listen(0, '127.0.0.1', r));
    const port = (portServer.address() as any).port;
    await new Promise<void>((r) => portServer.close(() => r()));
    const dir = mkdtempSync(join(tmpdir(), 'paystream-invitations-'));
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
        MongooseModule.forRoot(`mongodb://127.0.0.1:${port}/invitation_test`),
        AuthModule,
      ],
    })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .overrideProvider(InvitationMail)
      .useValue(mail)
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
    service = app.get(UsersService);
    invitations = app.get(InvitationsService);
    await db.collection('organizations').insertMany([
      { organizationId: org, normalizedName: 'invitation a', status: 'active' },
      {
        organizationId: otherOrg,
        normalizedName: 'invitation b',
        status: 'active',
      },
    ]);
    admin = await users.create({
      email: 'admin@example.test',
      role: 'admin',
      active: true,
      organizationId: org,
      passwordHash: await hashPassword(password),
    });
    other = await users.create({
      email: 'other@example.test',
      role: 'admin',
      active: true,
      organizationId: otherOrg,
      passwordHash: await hashPassword(password),
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: admin.email, password })
      .expect(200);
    cookie = login.headers['set-cookie'][0].split(';')[0];
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
  afterEach(() => {
    failEmail = false;
  });
  it('creates names through the API, emails only after save, consumes once, then permits login', async () => {
    const dto = {
      firstName: '  Asha  ',
      lastName: '  Rao  ',
      email: '  INVITED@EXAMPLE.TEST ',
      role: 'user',
      active: true,
    };
    const response = await request(app.getHttpServer())
      .post('/users')
      .set(headers)
      .set('Cookie', cookie)
      .send(dto)
      .expect(201);
    expect(response.body).toMatchObject({
      firstName: 'Asha',
      lastName: 'Rao',
      invitationPending: true,
      invitationSent: true,
    });
    for (const key of [
      'passwordHash',
      'invitationHash',
      'invitationExpiresAt',
      'sessionVersion',
    ])
      expect(response.body).not.toHaveProperty(key);
    const saved = await users
      .findById(response.body.id)
      .select('+invitationHash');
    const token = tokenFor('invited@example.test');
    expect(saved).toMatchObject({
      organizationId: org,
      firstName: 'Asha',
      lastName: 'Rao',
    });
    expect(saved!.invitationHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(messages.at(-1)).toMatchObject({
      first: 'Asha',
      last: 'Rao',
      hours: 24,
    });
    expect(new URL(messages.at(-1)!.url).search).toBe('');
    await expect(
      app.get(AuthService).login('invited@example.test', password),
    ).rejects.toThrow('Invalid email or password');
    const list = await request(app.getHttpServer())
      .get('/users')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.find((u: any) => u.id === response.body.id)).toMatchObject(
      { firstName: 'Asha', lastName: 'Rao' },
    );
    await request(app.getHttpServer())
      .post('/auth/invitation/inspect')
      .set(headers)
      .send({ token })
      .expect(200, {
        firstName: 'Asha',
        message: 'Set your password to finish setting up your account.',
      });
    await request(app.getHttpServer())
      .post('/auth/invitation/complete')
      .set(headers)
      .send({
        token,
        password: 'recipient-password',
        confirmation: 'recipient-password',
      })
      .expect(200);
    const used = await users
      .findById(saved!.id)
      .select('+invitationHash +invitationExpiresAt');
    expect(used!.invitationPending).toBe(false);
    expect(used!.invitationHash).toBeUndefined();
    expect(used!.invitationExpiresAt).toBeUndefined();
    await expect(
      invitations.complete(token, 'another-password', 'another-password'),
    ).rejects.toThrow('invitation');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email: 'invited@example.test', password: 'recipient-password' })
      .expect(200);
    expect(login.body).toMatchObject({
      firstName: 'Asha',
      lastName: 'Rao',
      organizationId: org,
    });
  });
  it('rejects missing/blank/long names, null name edits, invalid passwords and cross-origin setup', async () => {
    const before = mail.send.mock.calls.length;
    for (const firstName of ['', ' ', 'x'.repeat(101), undefined])
      await request(app.getHttpServer())
        .post('/users')
        .set(headers)
        .set('Cookie', cookie)
        .send({
          firstName,
          lastName: 'Rao',
          email: 'bad@example.test',
          role: 'user',
          active: true,
        })
        .expect(400);
    expect(mail.send.mock.calls).toHaveLength(before);
    const user = await create();
    const token = tokenFor(user.email);
    await request(app.getHttpServer())
      .patch('/users/' + user.id)
      .set(headers)
      .set('Cookie', cookie)
      .send({ firstName: null, email: user.email, role: 'user' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/invitation/complete')
      .set(headers)
      .send({ token, password: 'short', confirmation: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/invitation/complete')
      .set(headers)
      .send({
        token,
        password: 'long-password',
        confirmation: 'mismatch-value',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/invitation/complete')
      .set({ ...headers, Origin: 'https://other.test' })
      .send({ token, password: 'long-password', confirmation: 'long-password' })
      .expect(403);
  });
  it('rejects expired, disabled, deleted and organization-disabled invitations without disclosing identity', async () => {
    for (const state of ['expired', 'disabled', 'deleted', 'organization']) {
      const row = await create();
      const token = tokenFor(row.email);
      if (state === 'expired')
        await users.updateOne(
          { _id: row.id },
          { $set: { invitationExpiresAt: new Date(0) } },
        );
      if (state === 'disabled')
        await service.status(admin.id, 0, row.id, false);
      if (state === 'deleted') await users.deleteOne({ _id: row.id });
      if (state === 'organization')
        await db
          .collection('organizations')
          .updateOne({ organizationId: org }, { $set: { status: 'inactive' } });
      await expect(invitations.inspect(token)).rejects.toThrow(
        'invalid, expired, already used, or unavailable',
      );
      if (state === 'organization')
        await db
          .collection('organizations')
          .updateOne({ organizationId: org }, { $set: { status: 'active' } });
    }
    await expect(invitations.inspect('a'.repeat(43))).rejects.toThrow(
      'invitation',
    );
  });
  it('preserves accounts on email failure, prevents duplicate creates, scopes resends and invalidates old links', async () => {
    failEmail = true;
    const row = await create();
    expect(row.invitationSent).toBe(false);
    expect(await users.countDocuments({ _id: row.id })).toBe(1);
    expect(
      await users.findById(row.id).select('+invitationHash'),
    ).toMatchObject({ invitationPending: true, invitationDelivery: 'failed' });
    const attempts = mail.send.mock.calls.length;
    await expect(create({ email: row.email })).rejects.toThrow(
      'already exists',
    );
    expect(mail.send.mock.calls).toHaveLength(attempts);
    await expect(service.resend(other.id, 0, row.id)).rejects.toThrow(
      'User not found',
    );
    await users.updateOne(
      { _id: row.id },
      { $set: { invitationSentAt: new Date(0) } },
    );
    failEmail = false;
    await service.resend(admin.id, 0, row.id);
    const oldToken = tokenFor(row.email);
    await expect(service.resend(admin.id, 0, row.id)).rejects.toThrow(
      'wait a minute',
    );
    await users.updateOne(
      { _id: row.id },
      { $set: { invitationSentAt: new Date(0) } },
    );
    await service.resend(admin.id, 0, row.id);
    await expect(invitations.inspect(oldToken)).rejects.toThrow('invitation');
    const newToken = tokenFor(row.email);
    expect(newToken).not.toBe(oldToken);
    await expect(
      service.details(other.id, 0, row.id, {
        email: row.email,
        role: 'user',
        firstName: 'Other',
      }),
    ).rejects.toThrow('User not found');
    await service.details(admin.id, 0, row.id, {
      email: row.email,
      role: 'user',
      firstName: 'Updated',
      lastName: 'Name',
    });
    expect(
      (await service.list(admin.id, 0)).find((u) => u.id === row.id),
    ).toMatchObject({ firstName: 'Updated', lastName: 'Name' });
    await service.password(admin.id, 0, row.id, 'admin-set-password');
    await expect(
      app.get(AuthService).login(row.email, 'admin-set-password'),
    ).rejects.toThrow('Invalid email or password');
    const results = await Promise.allSettled([
      invitations.complete(
        newToken,
        'recipient-password',
        'recipient-password',
      ),
      invitations.complete(
        newToken,
        'recipient-password',
        'recipient-password',
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('invalidates pending links on email changes and preserves legacy users without names', async () => {
    const row = await create();
    const token = tokenFor(row.email);
    await service.details(admin.id, 0, row.id, {
      email: 'changed@example.test',
      role: 'user',
    });
    await expect(invitations.inspect(token)).rejects.toThrow('invitation');
    const legacy = (await service.list(admin.id, 0)).find(
      (u) => u.id === admin.id,
    );
    expect(legacy!.email).toBe(admin.email);
    expect(legacy).not.toHaveProperty('firstName');
  });
  it('escapes personal data and includes branded HTML, fallback URL and plain text', () => {
    const mail = invitationEmail(
      '<Asha>',
      'Rao',
      'https://example.test/set-password#token=SAFE_PREVIEW',
      24,
    );
    expect(mail.html).toContain('&lt;Asha&gt; Rao');
    expect(mail.html).not.toContain('Hello <Asha>');
    expect(mail.html).toContain('Set Your Password');
    expect(mail.html).toContain('An Excelhire Product');
    expect(mail.text).toContain('SAFE_PREVIEW');
  });

  it('preserves platform name updates and protects usable administrators while pending admins can be disabled', async () => {
    const pending = await create({ role: 'admin' });
    await service.status(admin.id, 0, pending.id, false);
    expect((await users.findById(pending.id))!.active).toBe(false);
    const superAdmin = await users.create({
      email: 'platform@example.test',
      role: 'super_admin',
      active: true,
      passwordHash: await hashPassword(password),
    });
    const platform = app.get(PlatformService);
    await create({ role: 'admin' }); // A pending admin cannot replace the last usable administrator.
    await expect(
      platform.updateAccount(superAdmin.id, 0, org, admin.id, {
        active: false,
      }),
    ).rejects.toThrow('last active administrator');
    const account = await platform.createAccount(superAdmin.id, 0, org, {
      email: 'platform-created@example.test',
      role: 'user',
      active: true,
      password,
      firstName: 'Platform',
      lastName: 'Name',
    });
    expect(account).toMatchObject({ firstName: 'Platform', lastName: 'Name' });
    expect((await users.findById(account.id))!.mustChangePassword).toBe(true);
    await platform.updateAccount(superAdmin.id, 0, org, account.id, {
      details: {
        email: account.email,
        role: 'user',
        firstName: 'Updated',
        lastName: 'Platform',
      },
    });
    expect(await users.findById(account.id)).toMatchObject({
      firstName: 'Updated',
      lastName: 'Platform',
    });
  });
  const browserTest = process.env.RUN_INVITATION_BROWSER === '1' ? it : it.skip;
  browserTest(
    'connects Add User, controlled email, Set Password and real sign in in the browser',
    async () => {
      const {
        chromium,
        expect: browserExpect,
      } = require('../../../payroll-frontend/node_modules/@playwright/test');
      const { mkdirSync, writeFileSync } = require('node:fs');
      const evidence = join(
        __dirname,
        '../../../payroll-frontend/docs/design-system/evidence/user-invitations',
      );
      mkdirSync(evidence, { recursive: true });
      await app.listen(0, '127.0.0.1');
      const backend = await app.getUrl();
      const browser = await chromium.launch({
        channel: 'msedge',
        headless: true,
      });
      try {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const browserErrors: string[] = [];
        page.on('pageerror', (e: any) => browserErrors.push(e.message));
        // Bridge the existing API origin to this isolated test server. Production code is unchanged.
        await page.route('http://localhost:3000/**', async (r: any) => {
          const request = r.request();
          const url = new URL(request.url());
          if (url.pathname === '/settings/organization')
            return r.fulfill({
              json: { displayName: 'Invitation test organization' },
            });
          if (url.pathname === '/employees') return r.fulfill({ json: [] });
          const response = await r.fetch({
            url: backend + url.pathname + url.search,
            headers: {
              ...request.headers(),
              origin: headers.Origin,
              host: new URL(backend).host,
            },
          });
          await r.fulfill({
            response,
            headers: {
              ...response.headers(),
              'access-control-allow-origin': 'http://localhost:4201',
              'access-control-allow-credentials': 'true',
            },
          });
        });
        await page.goto('http://localhost:4201/login');
        await page.getByLabel('Email address').fill(admin.email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .getByRole('link', { name: 'User Management', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Add User', exact: true })
          .click();
        const dialog = page.getByRole('dialog', {
          name: 'Add User',
          exact: true,
        });
        await browserExpect(
          dialog.getByRole('button', { name: 'Save', exact: true }),
        ).toBeDisabled();
        await dialog.getByLabel('First Name', { exact: true }).fill('  Mira  ');
        await dialog.getByLabel('Last Name', { exact: true }).fill('  Shah  ');
        await dialog
          .getByLabel('Email address', { exact: true })
          .fill('browser-invited@example.test');
        await page.screenshot({
          path: join(evidence, 'add-user-1440.png'),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: join(evidence, 'add-user-390.png'),
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await browserExpect(dialog).not.toBeVisible();
        await browserExpect(page.getByRole('status')).toContainText(
          'Invitation request accepted',
        );
        const saved = await users.findOne({
          email: 'browser-invited@example.test',
        });
        expect(saved).toMatchObject({
          firstName: 'Mira',
          lastName: 'Shah',
          organizationId: org,
        });
        const email = messages.find(
          (m) => m.to === 'browser-invited@example.test',
        )!;
        expect(email).toBeDefined();
        const safeEmail = invitationEmail(
          email.first,
          email.last,
          'https://paystream.example/set-password#token=SAFE_PREVIEW_NOT_A_REAL_TOKEN',
          email.hours,
        );
        writeFileSync(
          join(evidence, 'invitation-email-preview.html'),
          safeEmail.html,
        );
        await page.setContent(safeEmail.html);
        await page.screenshot({
          path: join(evidence, 'invitation-email-1440.png'),
          fullPage: true,
        });
        // Log out the administrator before opening the recipient's bearer invitation.
        await page.goto('http://localhost:4201/users');
        await page
          .getByRole('button', { name: 'Sign out', exact: true })
          .click();
        await browserExpect(page).toHaveURL(/\/login$/);
        const link = email.url.replace(
          'http://localhost:4200',
          'http://localhost:4201',
        );
        await page.goto(link);
        await browserExpect(
          page.getByRole('heading', { name: 'Welcome, Mira', exact: true }),
        ).toBeVisible();
        await browserExpect(page).toHaveURL(
          'http://localhost:4201/set-password',
        );
        await page.screenshot({
          path: join(evidence, 'set-password-1440.png'),
          fullPage: true,
        });
        await page
          .getByLabel('New Password', { exact: true })
          .fill('recipient-browser-password');
        await page
          .getByRole('button', { name: 'Show new password', exact: true })
          .click();
        await browserExpect(
          page.getByLabel('New Password', { exact: true }),
        ).toHaveAttribute('type', 'text');
        await page
          .getByRole('button', { name: 'Hide new password', exact: true })
          .click();
        await page
          .getByLabel('Confirm Password', { exact: true })
          .fill('different-password');
        await browserExpect(
          page.getByRole('button', { name: 'Set Password', exact: true }),
        ).toBeDisabled();
        await page
          .getByLabel('Confirm Password', { exact: true })
          .fill('recipient-browser-password');
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: join(evidence, 'set-password-390.png'),
          fullPage: true,
        });
        await page
          .getByRole('button', { name: 'Set Password', exact: true })
          .click();
        await browserExpect(page.getByRole('status')).toContainText(
          'Your password is set',
        );
        await browserExpect(page).toHaveURL(/\/login$/, { timeout: 10000 });
        await page
          .getByLabel('Email address')
          .fill('browser-invited@example.test');
        await page
          .getByLabel('Password', { exact: true })
          .fill('recipient-browser-password');
        await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        await browserExpect(
          page.getByRole('heading', { name: 'Employees', exact: true }),
        ).toBeVisible();
        await expect(
          invitations.inspect(tokenFor(saved!.email)),
        ).rejects.toThrow('invitation');
        await page.goto(link);
        await browserExpect(page.getByRole('alert')).toContainText(
          'already used',
        );
        await browserExpect(
          page.getByLabel('New Password', { exact: true }),
        ).toHaveCount(0);
        expect(browserErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60000,
  );

  it('resets with a hashed single-use token, cooldown, session revocation and one security notification', async () => {
    const reset = app.get(PasswordResetService);
    const email = 'reset-' + randomUUID() + '@example.test';
    const user = await users.create({
      email,
      organizationId: org,
      active: true,
      role: 'user',
      passwordHash: await hashPassword(password),
    });
    const known = await reset.request(email);
    const unknown = await reset.request(
      'unknown-' + randomUUID() + '@example.test',
    );
    expect(known).toEqual(unknown);
    const message = resetMessages.at(-1)!;
    expect(message.to).toBe(email);
    const token = message.content.text.split('#token=')[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = await users
      .findById(user.id)
      .select('+resetHash +resetExpiresAt');
    expect(saved!.resetHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify(await users.findById(user.id))).not.toContain(token);
    const count = resetMessages.length;
    await reset.request(email);
    expect(resetMessages).toHaveLength(count);
    await reset.inspect(token);
    const before = emailMock.passwordChanged.mock.calls.length;
    await reset.complete(token, 'new-test-password', 'new-test-password');
    expect(emailMock.passwordChanged.mock.calls.length).toBe(before + 1);
    await expect(
      reset.complete(token, 'another-password', 'another-password'),
    ).rejects.toThrow('already used');
    expect(
      (await users.findById(user.id).select('+sessionVersion'))!.sessionVersion,
    ).toBe(1);
    await expect(
      app.get(AuthService).login(email, 'new-test-password'),
    ).resolves.toMatchObject({ email });
  });
  it('rejects expired resets and inactive organizations and invalidates earlier reset tokens', async () => {
    const reset = app.get(PasswordResetService);
    const email = 'expiry-' + randomUUID() + '@example.test';
    const user = await users.create({
      email,
      organizationId: org,
      active: true,
      role: 'user',
      passwordHash: await hashPassword(password),
    });
    await reset.request(email);
    const old = resetMessages.at(-1)!.content.text.split('#token=')[1];
    await users.updateOne(
      { _id: user._id },
      { $set: { resetRequestedAt: new Date(0) } },
    );
    await reset.request(email);
    await expect(reset.inspect(old)).rejects.toThrow('invalid');
    const token = resetMessages.at(-1)!.content.text.split('#token=')[1];
    await users.updateOne(
      { _id: user._id },
      { $set: { resetExpiresAt: new Date(0) } },
    );
    await expect(reset.inspect(token)).rejects.toThrow('expired');
    const otherUser = await users.create({
      email: 'inactive-' + randomUUID() + '@example.test',
      organizationId: 'INACTIVE',
      active: true,
      role: 'user',
      passwordHash: await hashPassword(password),
    });
    const count = resetMessages.length;
    await reset.request(otherUser.email);
    expect(resetMessages).toHaveLength(count);
  });
  it('revokes reset links after an admin email update or deactivation and notifies on password changes', async () => {
    const reset = app.get(PasswordResetService);
    const email = 'revoke-' + randomUUID() + '@example.test';
    const user = await users.create({
      email,
      organizationId: org,
      active: true,
      role: 'user',
      passwordHash: await hashPassword(password),
    });
    await reset.request(email);
    const old = resetMessages.at(-1)!.content.text.split('#token=')[1];
    const newEmail = 'changed-' + randomUUID() + '@example.test';
    await service.details(admin.id, 0, user.id, {
      email: newEmail,
      role: 'user',
    });
    await expect(reset.inspect(old)).rejects.toThrow('invalid');
    await users.updateOne(
      { _id: user._id },
      { $set: { resetRequestedAt: new Date(0) } },
    );
    await reset.request(newEmail);
    const second = resetMessages.at(-1)!.content.text.split('#token=')[1];
    await service.status(admin.id, 0, user.id, false);
    await service.status(admin.id, 0, user.id, true);
    await expect(reset.inspect(second)).rejects.toThrow('invalid');
    const updated = await users.findById(user.id).select('+sessionVersion');
    const before = emailMock.passwordChanged.mock.calls.length;
    await app
      .get(AuthService)
      .changePassword(
        user.id,
        updated!.sessionVersion,
        password,
        'changed-test-password',
      );
    expect(emailMock.passwordChanged.mock.calls.length).toBe(before + 1);
  });
  it('rate limits password reset routes and enforces origin checks', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'unknown@example.test' })
      .expect(403);
    let last: any;
    for (let i = 0; i < 11; i++)
      last = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set(headers)
        .send({ email: 'unknown@example.test' });
    expect(last.status).toBe(429);
  });
  it('rate limits public invitation attempts without exposing account information', async () => {
    let last: any;
    for (let i = 0; i < 11; i++)
      last = await request(app.getHttpServer())
        .post('/auth/invitation/inspect')
        .set(headers)
        .send({ token: 'z'.repeat(43) });
    expect(last.status).toBe(429);
    expect(last.body.message).toContain('Too many invitation attempts');
  });
});
