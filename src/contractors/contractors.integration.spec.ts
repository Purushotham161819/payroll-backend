import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ContractorsModule } from './contractors.module';
import { ContractorsService } from './contractors.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
const integration =
  process.env.RUN_CONTRACTOR_MONGO_TESTS === '1' ? describe : describe.skip;
integration(
  'Contractor APIs, isolation and immutable persistent payments (isolated MongoDB)',
  () => {
    let app: INestApplication, db: Connection, service: ContractorsService;
    const name = 'contractor_test_' + process.pid + '_' + Date.now();
    const org = 'ORG000901',
      other = 'ORG000902';
    const users: Record<string, any> = {
      admin: { id: 'admin', role: 'admin', organizationId: org },
      member: { id: 'member', role: 'user', organizationId: org },
      other: { id: 'other', role: 'admin', organizationId: other },
      super: { id: 'super', role: 'super_admin' },
      legacy: { id: 'legacy', role: 'admin' },
    };
    const api = (who = 'admin') => ({
      get: (p: string) =>
        request(app.getHttpServer())
          .get('/contractors' + p)
          .set('X-Test-User', who),
      post: (p: string, body: any) =>
        request(app.getHttpServer())
          .post('/contractors' + p)
          .set({
            'X-Test-User': who,
            Origin: 'http://localhost:4200',
            'X-Payroll-Request': '1',
          })
          .send(body),
      patch: (p: string, body: any) =>
        request(app.getHttpServer())
          .patch('/contractors' + p)
          .set({
            'X-Test-User': who,
            Origin: 'http://localhost:4200',
            'X-Payroll-Request': '1',
          })
          .send(body),
    });
    const create = async (who = 'admin') =>
      (
        await api(who)
          .post('', {
            firstName: 'Ada',
            lastName: 'Contractor',
            email: randomUUID() + '@example.test',
          })
          .expect(201)
      ).body;
    const component = async (classification = 'deduction', who = 'admin') =>
      (
        await api(who)
          .post('/components', {
            name: 'Independent ' + classification,
            code: 'C_' + randomUUID().replaceAll('-', ''),
            classification,
            status: 'active',
            calculationType: 'fixed',
            calculationValue: 10,
          })
          .expect(201)
      ).body;
    const assign = async (c: any, ids: string[], who = 'admin') =>
      (
        await api(who)
          .patch('/' + c._id + '/components', {
            version: c.version,
            componentIds: ids,
          })
          .expect(200)
      ).body;
    const dto = (c: any, components: any[]) => ({
      idempotencyKey: randomUUID(),
      paymentDate: '2026-11-03',
      description: 'Manual invoice payment',
      entries: [
        {
          contractorId: c._id,
          contractorVersion: c.version,
          grossPay: 100.25,
          components: components.map((p) => ({
            componentId: p._id,
            componentVersion: p.version,
          })),
        },
      ],
    });
    beforeAll(async () => {
      const module = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
            dbName: name,
            serverSelectionTimeoutMS: 3000,
          }),
          ContractorsModule,
        ],
        providers: [
          {
            provide: AuthService,
            useValue: {
              current: async (id: string) => {
                if (!users[id]) throw new UnauthorizedException();
                return users[id];
              },
            },
          },
          { provide: APP_GUARD, useClass: AuthGuard },
        ],
      }).compile();
      app = module.createNestApplication();
      app.use((req: any, _res: any, next: () => void) => {
        req.session = {
          userId: req.get('X-Test-User'),
          expiresAt: Date.now() + 60000,
        };
        next();
      });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      db = app.get(getConnectionToken());
      service = app.get(ContractorsService);
    }, 30000);
    afterAll(async () => {
      if (db?.name === name && name.startsWith('contractor_test_'))
        await db.dropDatabase();
      await app?.close();
    });
    it('requires authenticated organization accounts and existing origin verification', async () => {
      await api('').get('').expect(401);
      await api('super').get('').expect(403);
      await api('legacy').get('').expect(403);
      await request(app.getHttpServer())
        .post('/contractors')
        .set('X-Test-User', 'admin')
        .send({})
        .expect(403);
    });
    it('creates unique independent CON identifiers, normalizes duplicates, and rejects employee fields', async () => {
      const c = await create();
      expect(c.contractorId).toMatch(/^CON\d{3,}$/);
      expect(c.componentIds).toEqual([]);
      await api()
        .post('', {
          firstName: 'Another',
          lastName: 'Name',
          email: c.email.toUpperCase(),
        })
        .expect(409);
      await api()
        .post('', {
          firstName: 'Bad',
          lastName: 'Fields',
          email: 'bad@example.test',
          annualCtc: 100,
        })
        .expect(400);
      expect(await db.collection('employees').countDocuments()).toBe(0);
      expect(await db.collection('salarycomponents').countDocuments()).toBe(0);
    });
    it('retrieves and updates contractors with optimistic version protection', async () => {
      const c = await create();
      const changed = (
        await api()
          .patch('/' + c._id, {
            firstName: 'Updated',
            lastName: c.lastName,
            email: c.email,
            version: 0,
          })
          .expect(200)
      ).body;
      expect(changed.version).toBe(1);
      expect(
        (
          await api()
            .get('/' + c._id)
            .expect(200)
        ).body.firstName,
      ).toBe('Updated');
      await api()
        .patch('/' + c._id, {
          firstName: 'Stale',
          lastName: c.lastName,
          email: c.email,
          version: 0,
        })
        .expect(409);
    });
    it('allows independent component reads but restricts configuration writes to administrators', async () => {
      const p = await component();
      await api('member').get('/components').expect(200);
      await api('member')
        .post('/components', {
          name: 'No',
          code: 'NO',
          classification: 'earning',
          status: 'active',
          calculationType: 'fixed',
          calculationValue: 10,
        })
        .expect(403);
      const updated = (
        await api()
          .patch('/components/' + p._id, {
            ...clean(p),
            name: 'Edited',
            calculationType: 'percentage',
            calculationValue: 5,
            version: 0,
          })
          .expect(200)
      ).body;
      expect(updated.calculationValue).toBe(5);
      await api()
        .patch('/components/' + p._id, { ...clean(p), version: 0 })
        .expect(409);
    });
    it('persists assignments only for valid contractor components and supports deselection', async () => {
      let c = await create();
      const p = await component();
      c = await assign(c, [p._id.toUpperCase()]);
      expect((await api().get('/' + c._id)).body.componentIds).toEqual([p._id]);
      await api()
        .patch('/' + c._id + '/components', {
          version: c.version,
          componentIds: ['507f1f77bcf86cd799439099'],
        })
        .expect(400);
      await api()
        .patch('/' + c._id + '/components', {
          version: c.version,
          componentIds: [p._id, p._id],
        })
        .expect(400);
      c = await assign(c, []);
      expect(c.componentIds).toEqual([]);
    });
    it('rejects every cross-organization identity, assignment, component update and payment reference', async () => {
      const c = await create(),
        p = await component(),
        b = await create('other');
      await api('other')
        .get('/' + c._id)
        .expect(404);
      await api('other')
        .patch('/' + c._id, {
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          version: 0,
        })
        .expect(404);
      await api('other')
        .patch('/components/' + p._id, { ...clean(p), version: 0 })
        .expect(404);
      await api('other')
        .patch('/' + b._id + '/components', {
          version: 0,
          componentIds: [p._id],
        })
        .expect(400);
      await api('other')
        .post('/payments', dto(c, [p]))
        .expect(404);
      await api('other')
        .get('/' + c._id + '/payments')
        .expect(404);
      expect(b.contractorId).toBe('CON001');
    });
    it('validates payment dates, assignment, component references, amounts and duplicate selections', async () => {
      let c = await create();
      const p = await component();
      await api()
        .post('/payments', dto(c, [p]))
        .expect(400);
      c = await assign(c, [p._id]);
      for (const amount of [-1, 0.001, 1e10]) {
        const d = dto(c, [p]);
        d.entries[0].grossPay = amount;
        await api().post('/payments', d).expect(400);
      }
      await api()
        .post('/payments', { ...dto(c, [p]), paymentDate: '2026-02-29' })
        .expect(400);
      const d = dto(c, [p]);
      d.entries[0].components.push({ ...d.entries[0].components[0] });
      await api().post('/payments', d).expect(400);
      await api()
        .post('/payments', { ...dto(c, [p]), description: ' ' })
        .expect(400);
    });
    it('atomically records multi-contractor payments and rejects concurrent duplicate submissions', async () => {
      let a = await create(),
        b = await create();
      const p = await component(),
        deduct = await component('deduction');
      a = await assign(a, [p._id, deduct._id]);
      b = await assign(b, [p._id]);
      const d = dto(a, [p, deduct]);
      d.entries[0].contractorId = d.entries[0].contractorId.toUpperCase();
      d.entries[0].components.forEach(
        (line) => (line.componentId = line.componentId.toUpperCase()),
      );
      d.entries.push(dto(b, [p]).entries[0]);
      const responses = await Promise.all([
        api().post('/payments', d),
        api().post('/payments', d),
      ]);
      expect(responses.map((r) => r.status)).toEqual([201, 201]);
      expect(responses[0].body._id).toBe(responses[1].body._id);
      const models = service.models(org);
      expect(
        await models.payments.countDocuments({
          idempotencyKey: d.idempotencyKey,
        }),
      ).toBe(1);
      const history = (await api().get('/' + a._id + '/payments')).body;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        netPayment: 80.25,
        grossPay: 100.25,
        totalDeductions: 20,
        status: 'Recorded',
      });
      expect(history[0].paymentId).toMatch(/^CPAY\d{3,}$/);
      expect((await api().get('/' + b._id + '/payments')).body).toHaveLength(1);
      const invalid = {
        ...d,
        idempotencyKey: randomUUID(),
        entries: [
          ...d.entries,
          { ...d.entries[0], contractorId: '507f1f77bcf86cd799439099' },
        ],
      };
      await api().post('/payments', invalid).expect(404);
      expect(
        await models.payments.countDocuments({
          idempotencyKey: invalid.idempotencyKey,
        }),
      ).toBe(0);
      await api()
        .post('/payments', { ...d, description: 'Different' })
        .expect(409);
    });
    it('refuses permanent deletion on standalone MongoDB without changing contractor or payments', async () => {
      const c = await create();
      await api().post('/payments', dto(c, [])).expect(201);
      const before = (await api().get('/' + c._id + '/payments')).body;
      await request(app.getHttpServer()).delete('/contractors/' + c._id)
        .set({ 'X-Test-User': 'admin', Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' })
        .expect(503).expect(result => expect(result.body.message).toContain('No records were changed'));
      await api().get('/' + c._id).expect(200);
      expect((await api().get('/' + c._id + '/payments')).body).toEqual(before);
    });
    it('persists independent entry descriptions and keeps their idempotency snapshots', async () => {
      const a = await create(), b = await create();
      const original = dto(a, []);
      const body = {
        idempotencyKey: original.idempotencyKey,
        paymentDate: original.paymentDate,
        entries: [
          { ...original.entries[0], description: 'Ada invoice' },
          { ...dto(b, []).entries[0], description: 'Grace invoice' },
        ],
      };
      const response = (await api().post('/payments', body).expect(201)).body;
      expect(response.entries.map((e: any) => e.description)).toEqual(['Ada invoice', 'Grace invoice']);
      expect((await api().get('/' + a._id + '/payments')).body[0].description).toBe('Ada invoice');
      expect((await api().get('/' + b._id + '/payments')).body[0].description).toBe('Grace invoice');
      expect((await api().post('/payments', body).expect(201)).body.entries).toEqual(response.entries);
      await api().post('/payments', { ...body, entries: [{ ...body.entries[0], description: 'Different invoice' }, body.entries[1]] }).expect(409);
      expect(await service.models(org).payments.countDocuments({ idempotencyKey: body.idempotencyKey })).toBe(1);
    });
    it('rejects missing or invalid contractor descriptions atomically without requiring a batch description', async () => {
      const a = await create(), b = await create();
      for (const description of [undefined, '', ' ', 'x'.repeat(1001)]) {
        const original = dto(a, []);
        const body = { idempotencyKey: original.idempotencyKey, paymentDate: original.paymentDate, entries: [
          { ...original.entries[0], description: 'Valid invoice' },
          { ...dto(b, []).entries[0], description },
        ] };
        await api().post('/payments', body).expect(400);
        expect(await service.models(org).payments.countDocuments({ idempotencyKey: body.idempotencyKey })).toBe(0);
      }
    });
    it('preserves immutable history after identity, configuration, classification and status changes; retries replay snapshots', async () => {
      let c = await create();
      const p = await component();
      c = await assign(c, [p._id]);
      const d = dto(c, [p]);
      const saved = (await api().post('/payments', d).expect(201)).body;
      const before = (await api().get('/' + c._id + '/payments')).body;
      expect(
        (await api().get('/' + c._id.toUpperCase() + '/payments')).body,
      ).toEqual(before);
      await api()
        .patch('/components/' + p._id, {
          ...clean(p),
          name: 'Renamed',
          classification: 'deduction',
          status: 'inactive',
          version: 0,
        })
        .expect(200);
      await api()
        .patch('/' + c._id, {
          firstName: 'Changed',
          lastName: c.lastName,
          email: c.email,
          version: c.version,
        })
        .expect(200);
      expect((await api().get('/' + c._id + '/payments')).body).toEqual(before);
      expect((await api().post('/payments', d).expect(201)).body._id).toBe(
        saved._id,
      );
      const current = (await api().get('/' + c._id)).body;
      await api()
        .post('/payments', dto(current, [p]))
        .expect(400);
    });
    it('rejects stale configuration/assignment versions and negative net totals', async () => {
      let c = await create();
      const p = await component('deduction');
      c = await assign(c, [p._id]);
      const negative = dto(c, [p]);
      negative.entries[0].grossPay = 5;
      await api().post('/payments', negative).expect(400);
      const earning = await component();
      c = await assign(c, [earning._id]);
      const d = dto(c, [earning]);
      await api()
        .patch('/components/' + earning._id, {
          ...clean(earning),
          name: 'Revised',
          version: 0,
        })
        .expect(200);
      await api().post('/payments', d).expect(409);
    });

    it('calculates percentage, fixed and safe Gross Pay formulas on the server; rejects forged amounts', async () => {
      let c = await create();
      const fixed = await component();
      const rate = (
        await api()
          .post('/components', {
            ...clean(fixed),
            name: 'Rate',
            code: 'RATE_' + Date.now(),
            calculationType: 'percentage',
            calculationValue: 10,
          })
          .expect(201)
      ).body;
      const formula = (
        await api()
          .post('/components', {
            ...clean(fixed),
            name: 'Formula',
            code: 'FORM_' + Date.now(),
            calculationType: 'formula',
            formula: 'grossPay * 2% + 0.01',
          })
          .expect(201)
      ).body;
      c = await assign(c, [fixed._id, rate._id, formula._id]);
      const d = dto(c, [fixed, rate, formula]);
      d.entries[0].grossPay = 50000;
      const result = (await api().post('/payments', d).expect(201)).body
        .entries[0];
      expect(result).toMatchObject({
        calculationVersion: 2,
        grossPay: 50000,
        totalDeductions: 6010.01,
        netPayment: 43989.99,
      });
      expect(
        result.components.find((p: any) => p.componentId === rate._id),
      ).toMatchObject({
        calculationType: 'percentage',
        calculationValue: 10,
        calculationBase: 'grossPay',
        amount: 5000,
      });
      const forged: any = dto(c, [fixed, rate, formula]);
      forged.entries[0].components[0].amount = 0;
      await api().post('/payments', forged).expect(400);
      await api()
        .post('/payments', {
          ...d,
          idempotencyKey: randomUUID(),
          netPayment: 999999,
        })
        .expect(400);
      const missing = dto(c, [fixed, rate]);
      await api().post('/payments', missing).expect(400);
      await api()
        .post('/components', {
          ...clean(fixed),
          code: 'BADBASE',
          calculationBase: 'annualCtc',
        })
        .expect(400);
      await api()
        .post('/components', {
          ...clean(fixed),
          code: 'BADFORM',
          calculationType: 'formula',
          formula: 'globalThis.process.exit()',
        })
        .expect(400);
    });
    it('supports no deductions, zero Gross Pay, inactive exclusion and selected-only batches', async () => {
      let c = await create();
      const d = dto(c, []);
      d.entries[0].grossPay = 0;
      expect(
        (await api().post('/payments', d).expect(201)).body.entries[0],
      ).toMatchObject({
        grossPay: 0,
        totalDeductions: 0,
        netPayment: 0,
        components: [],
      });
      const p = await component();
      c = await assign(c, [p._id]);
      await api()
        .patch('/components/' + p._id, {
          ...clean(p),
          status: 'inactive',
          version: 0,
        })
        .expect(200);
      expect(
        (await api().post('/payments', dto(c, [])).expect(201)).body.entries[0],
      ).toMatchObject({
        grossPay: 100.25,
        totalDeductions: 0,
        netPayment: 100.25,
      });
      await api()
        .post('/payments', dto(c, [p]))
        .expect(400);
    });
    it('preserves earlier component records, assignments and stored history without inventing Gross Pay', async () => {
      let c = await create();
      const models = service.models(org);
      const legacy = await models.components.create({
        organizationId: org,
        name: 'Earlier earnings',
        code: 'LEGACY_' + Date.now(),
        classification: 'earning',
        status: 'active',
        calculationType: 'manual',
        calculationBase: 'Invoice',
      });
      await models.contractors.updateOne(
        { _id: c._id },
        { $set: { componentIds: [String(legacy._id)] } },
      );
      c = (await api().get('/' + c._id)).body;
      const old = {
        paymentId: 'CPAY_OLD_' + Date.now(),
        contractorId: c._id,
        contractorCode: c.contractorId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        components: [
          {
            componentId: String(legacy._id),
            componentVersion: 0,
            name: 'Earlier earnings',
            code: legacy.code,
            classification: 'earning',
            calculationType: 'manual',
            amount: 100,
          },
        ],
        totalEarnings: 100,
        totalAllowances: 20,
        totalDeductions: 10,
        netPayment: 110,
      };
      await models.payments.create({
        organizationId: org,
        idempotencyKey: randomUUID(),
        inputHash: 'legacy',
        paymentDate: '2026-10-01',
        description: 'Earlier component record',
        entries: [old],
        recordedBy: 'admin',
      });
      const before = (await api().get('/' + c._id + '/payments')).body;
      expect(before[0].grossPay).toBeUndefined();
      expect(before[0]).toMatchObject(old);
      const p = await component();
      c = await assign(c, [p._id]);
      expect(c.componentIds).toContain(String(legacy._id));
      const newResult = (
        await api()
          .post('/payments', dto(c, [p]))
          .expect(201)
      ).body.entries[0];
      expect(newResult.totalDeductions).toBe(10);
      expect(newResult.totalEarnings).toBeUndefined();
      await models.components.deleteOne({ _id: p._id });
      await models.components.updateOne(
        { _id: legacy._id },
        { $set: { name: 'Renamed earlier', status: 'inactive' } },
      );
      const history = (await api().get('/' + c._id + '/payments')).body;
      expect(history.find((p: any) => p.paymentId === old.paymentId)).toEqual(
        before[0],
      );
      expect(
        history.find((p: any) => p.paymentId === newResult.paymentId)
          .components[0].name,
      ).toBe(p.name);
    });
    it('blocks earlier manual deduction configurations and dangling assignments without changing them', async () => {
      let c = await create();
      const models = service.models(org);
      const p = await models.components.create({
        organizationId: org,
        name: 'Manual legacy',
        code: 'MANUAL_' + Date.now(),
        classification: 'deduction',
        status: 'active',
        calculationType: 'manual',
      });
      await api()
        .patch('/' + c._id + '/components', {
          version: c.version,
          componentIds: [String(p._id)],
        })
        .expect(400);
      await models.contractors.updateOne(
        { _id: c._id },
        { $set: { componentIds: [String(p._id)] } },
      );
      c = (await api().get('/' + c._id)).body;
      await api()
        .post('/payments', dto(c, [{ _id: String(p._id), version: 0 }]))
        .expect(400);
      expect((await api().get('/' + c._id)).body.componentIds).toEqual([
        String(p._id),
      ]);
      await models.components.deleteOne({ _id: p._id });
      await api().post('/payments', dto(c, [])).expect(409);
      c = await assign(c, []);
      await api().post('/payments', dto(c, [])).expect(201);
    });
    it('leaves no partially saved payments when the atomic batch insert fails; identical retry succeeds', async () => {
      const a = await create(),
        b = await create();
      const d = dto(a, []);
      d.entries.push(dto(b, []).entries[0]);
      const models = service.models(org);
      const spy = jest
        .spyOn(models.payments, 'create')
        .mockRejectedValueOnce(
          new Error('Simulated batch write failure') as never,
        );
      try {
        await api().post('/payments', d).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(
        await models.payments.countDocuments({
          idempotencyKey: d.idempotencyKey,
        }),
      ).toBe(0);
      expect((await api().get('/' + a._id + '/payments')).body).toEqual([]);
      expect((await api().get('/' + b._id + '/payments')).body).toEqual([]);
      const saved = (await api().post('/payments', d).expect(201)).body;
      expect(saved.entries).toHaveLength(2);
      expect(new Set(saved.entries.map((e: any) => e.paymentId)).size).toBe(2);
    });
    (process.env.RUN_CONTRACTOR_BROWSER_TESTS === '1' ? it : it.skip)(
      'persists a real browser contractor workflow through Nest APIs and MongoDB',
      async () => {
        const {
          chromium,
        } = require('../../../payroll-frontend/node_modules/playwright');
        await app.listen(0, '127.0.0.1');
        const address = app.getHttpServer().address();
        const base = `http://127.0.0.1:${address.port}`;
        const frontend =
          process.env.CONTRACTOR_BROWSER_URL || 'http://localhost:4200';
        const browser = await chromium.launch({
          channel: 'msedge',
          headless: true,
        });
        try {
          const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
          });
          await page.route('**/auth/me', (r: any) =>
            r.fulfill({ json: users.admin }),
          );
          await page.route(
            'http://localhost:3000/settings/organization',
            (r: any) =>
              r.fulfill({
                json: { displayName: 'Contractor QA Organization' },
              }),
          );
          await page.route(
            'http://localhost:3000/contractors**',
            async (r: any) => {
              const response = await r.fetch({
                url: base + new URL(r.request().url()).pathname,
                headers: {
                  ...r.request().headers(),
                  'X-Test-User': 'admin',
                  Origin: 'http://localhost:4200',
                  'X-Payroll-Request': '1',
                },
              });
              await r.fulfill({ response });
            },
          );
          await page.goto(frontend + '/settings/contractors');
          await page
            .getByRole('button', { name: 'Add Component', exact: true })
            .click();
          const dialog = page.getByRole('dialog', {
            name: 'Add Contractor Pay Component',
            exact: true,
          });
          await dialog
            .getByRole('textbox', { name: 'Component Name', exact: true })
            .fill('Browser Invoice Fee');
          await dialog
            .getByRole('textbox', { name: 'Component Code', exact: true })
            .fill('BROWSER_FEE');
          await dialog
            .getByRole('spinbutton', {
              name: 'Configuration Value',
              exact: true,
            })
            .fill('10');
          await dialog
            .getByRole('button', { name: 'Save Component', exact: true })
            .click();
          await dialog.waitFor({ state: 'detached' });
          await page.goto(frontend + '/contractors');
          await page
            .getByRole('button', { name: 'Add Contractor', exact: true })
            .click();
          const add = page.getByRole('dialog', {
            name: 'Add Contractor',
            exact: true,
          });
          await add
            .getByRole('textbox', { name: 'First Name', exact: true })
            .fill('Browser');
          await add
            .getByRole('textbox', { name: 'Last Name', exact: true })
            .fill('Persistent');
          await add
            .getByRole('textbox', { name: 'Email', exact: true })
            .fill('browser@example.test');
          await add
            .getByRole('button', { name: 'Save Contractor', exact: true })
            .click();
          await add.waitFor({ state: 'detached' });
          await page
            .getByRole('link', { name: 'Browser', exact: true })
            .click();
          await page.getByRole('button', { name: 'Edit Contractor Payment Components', exact: true }).click();
          await page
            .getByRole('checkbox', { name: /Browser Invoice Fee/ })
            .check();
          await page
            .getByRole('button', { name: 'Save Components', exact: true })
            .click();
          await page
            .getByRole('status')
            .filter({ hasText: 'assignments saved' })
            .waitFor();
          await page.reload();
          expect(
            await page
              .getByRole('checkbox', { name: /Browser Invoice Fee/ })
              .isChecked(),
          ).toBe(true);
          await page.goto(frontend + '/contractors');
          await page
            .getByRole('button', { name: 'Actions for Browser Persistent', exact: true }).click();
          await page
            .getByRole('menuitem', {
              name: 'Pay Contractor Browser Persistent',
              exact: true,
            })
            .click();
          const pay = page.getByRole('dialog', {
            name: 'Pay Contractor',
            exact: true,
          });
          await pay
            .getByRole('textbox', { name: 'Payment Date', exact: true })
            .fill('2026-11-03');
          await pay
            .getByRole('textbox', { name: 'Description for Browser Persistent', exact: true })
            .fill('Persisted browser invoice');
          await pay
            .getByRole('spinbutton', {
              name: 'Gross Pay for Browser Persistent',
              exact: true,
            })
            .fill('1234.56');
          await pay
            .getByRole('button', { name: 'Submit', exact: true })
            .click();
          const confirm = page.getByRole('dialog', {
            name: 'Confirm Payments',
            exact: true,
          });
          expect(await confirm.textContent()).toContain('1,234.56');
          await confirm
            .getByRole('button', { name: 'Confirm Payments', exact: true })
            .click();
          await confirm.waitFor({ state: 'detached' });
          await page
            .getByRole('link', { name: 'Browser', exact: true })
            .click();
          await page
            .getByRole('tab', { name: 'Payments', exact: true })
            .click();
          await page.reload();
          const history = page.getByRole('table', {
            name: 'Contractor payments',
            exact: true,
          });
          await history
            .getByText('Persisted browser invoice', { exact: true })
            .waitFor();
          expect(await history.textContent()).toContain('1,234.56');
          await page.screenshot({
            path: '../payroll-frontend/artifacts/contractor-payment-enhancement/screenshots/persistent-browser-history.png',
            fullPage: true,
          });
          const models = service.models(org),
            contractor = await models.contractors
              .findOne({ email: 'browser@example.test' })
              .lean();
          const saved = await service.history(org, String(contractor!._id));
          expect(saved).toHaveLength(1);
          expect(saved[0].grossPay).toBe(1234.56);
          expect(saved[0].totalDeductions).toBe(123.46);
          expect(saved[0].netPayment).toBe(1111.1);
          expect(await db.collection('employees').countDocuments()).toBe(0);
          const collections = await db
            .db!.listCollections({}, { nameOnly: true })
            .toArray();
          expect(
            collections.filter((c) =>
              /employee|salary|payroll|tds|tax/i.test(c.name),
            ),
          ).toEqual([]);
        } finally {
          await browser.close();
        }
      },
      90000,
    );
    function clean(c: any) {
      return {
        name: c.name,
        code: c.code,
        classification: c.classification,
        status: c.status,
        calculationType: c.calculationType,
        calculationValue: c.calculationValue,
        formula: c.formula || '',
      };
    }
  },
);
