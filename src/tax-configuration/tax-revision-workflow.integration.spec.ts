import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import type { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import request from 'supertest';
import { IncomeTaxModule } from '../income-tax/income-tax.module';
import { tenantContext } from '../organizations/tenant-context';
import type { TaxRules } from '../income-tax/tax.types';

const integration =
  process.env.RUN_TAX_MONGO_TESTS === '1' ? describe : describe.skip;
integration(
  'Tax revision and salary-component workflow (isolated MongoDB)',
  () => {
    let app: INestApplication,
      connection: Connection,
      components: any[],
      rules: TaxRules;
    const dbName = `tax_revision_workflow_test_${process.pid}_${Date.now()}`;
    const year = {
      code: 'FY 2026-27',
      name: 'QA Financial Year 2026-27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      legislation: 'Income-tax Act, 2025',
      ruleVersion: 'ITACT2025_FA2026_V1.0',
    };
    const root = '/settings/tax-configuration';
    const api = () => request(app.getHttpServer());
    const payload = (regime = 'new') => ({
      version: 1,
      yearCode: year.code,
      regime,
      effectiveDate: year.startDate,
      rules,
    });
    beforeAll(async () => {
      const module = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
            dbName,
            serverSelectionTimeoutMS: 3000,
          }),
          IncomeTaxModule,
        ],
      }).compile();
      app = module.createNestApplication();
      app.use((req: any, _res: any, next: () => void) => {
        req.account = {
          id: 'qa-admin',
          role: req.headers['x-test-role'] ?? 'admin',
        };
        const organizationId = req.headers['x-test-tenant'];
        tenantContext.run(
          {
            organizationId: ['ORG999901', 'ORG999902'].includes(
              organizationId as string,
            )
              ? (organizationId as string)
              : undefined,
          },
          next,
        );
      });
      await app.init();
      connection = app.get(getConnectionToken());
    });
    beforeEach(async () => {
      await connection.collection('tax_configuration_registry').deleteMany({});
      await connection
        .collection('org999902_tax_configuration_registry')
        .deleteMany({});
      const model = connection.model('SalaryComponent');
      await model.deleteMany({});
      for (const [name, code, category, status] of [
        ['Shift Allowance', 'SHIFT', 'allowance', 'active'],
        ['Basic Salary', 'BASIC', 'earning', 'active'],
        ['Employer Fund Amount', 'ER', 'earning', 'active'],
        ['Employee Fund Deduction', 'EE', 'deduction', 'active'],
        ['Inactive Allowance', 'OLD', 'allowance', 'inactive'],
      ])
        await model.create({
          name,
          code,
          category,
          status,
          calculationType: 'fixed',
          calculationBaseType: 'annual_ctc',
          fixedAmountPeriod: 'annual',
          calculationValue: 1000,
        });
      components = await model.find().sort({ createdAt: 1, _id: 1 }).lean();
      rules = {
        ruleVersion: 'salary-only-v1',
        standardDeduction: 75000,
        rebateLimit: 1200000,
        maximumRebate: 60000,
        rebateMarginalRelief: true,
        cessPercentage: 4,
        surcharge: [],
        surchargeMarginalRelief: true,
        incomeRounding: 'nearest-ten-ignore-paise',
        liabilityRounding: 'nearest-ten-ignore-paise',
        minimumAge: 0,
        maximumAge: null,
        slabs: [{ from: 0, to: null, rate: 0 }],
        mappings: components
          .filter((c) => c.status === 'active' && c.category !== 'deduction')
          .map((c) => ({
            componentId: c._id.toString(),
            type: 'taxable',
            legalReference: 'Isolated test evidence; not production approval',
          })),
        employerContributionsReviewed: true,
        reviewNote: 'Test-only complete revision',
        legalReferences: [
          'https://www.incometaxindia.gov.in/Documents/Act/Income-tax-Act-2025.pdf',
        ],
      };
      await api()
        .put(root + '/years')
        .send({ version: 0, createOnly: true, year })
        .expect(200);
    });
    afterAll(async () => {
      if (
        connection?.name === dbName &&
        dbName.startsWith('tax_revision_workflow_test_')
      )
        await connection.dropDatabase();
      await app?.close();
    });
    it.each(['old', 'new'])(
      'saves a complete %s regime atomically with canonical component names',
      async (regime) => {
        const saved = await api()
          .post(root + '/revisions')
          .send(payload(regime))
          .expect(201);
        expect(saved.body.revisions).toHaveLength(1);
        expect(saved.body.revisions[0].regime).toBe(regime);
        expect(
          saved.body.revisions[0].rules.mappings.map(
            (m: any) => m.componentName,
          ),
        ).toEqual(['Shift Allowance', 'Basic Salary', 'Employer Fund Amount']);
        expect(
          saved.body.revisions[0].rules.mappings.map((m: any) => m.componentId),
        ).toEqual(rules.mappings.map((m) => m.componentId));
      },
    );
    it('rejects invalid master, slab, surcharge and review data without any partial revision', async () => {
      for (const invalid of [
        { standardDeduction: -1 },
        { slabs: [{ from: 1, to: null, rate: 0 }] },
        { surcharge: [{ threshold: 1, rate: 101 }] },
        { reviewNote: '' },
        { legalReferences: [] },
        { employerContributionsReviewed: false },
      ])
        await api()
          .post(root + '/revisions')
          .send({ ...payload(), rules: { ...rules, ...invalid } })
          .expect(400);
      const state = await api().get(root).expect(200);
      expect(state.body.revisions).toEqual([]);
      expect(state.body.version).toBe(1);
    });
    it('identifies a missing legal reference using the actual product name', async () => {
      rules.mappings[0].legalReference = '';
      const failed = await api()
        .post(root + '/revisions')
        .send(payload())
        .expect(400);
      expect(failed.body.message).toBe(
        'Legal reference is required for Shift Allowance.',
      );
      expect((await api().get(root)).body.revisions).toEqual([]);
    });
    it('rejects duplicate or missing component identities and employee deduction mappings', async () => {
      const original = structuredClone(rules.mappings);
      for (const mappings of [
        [...original, original[0]],
        [{ ...original[0], componentId: '' }],
        [
          ...original,
          {
            componentId: components
              .find((c) => c.category === 'deduction')
              ._id.toString(),
            type: 'taxable',
            legalReference: 'Test evidence',
          },
        ],
      ])
        await api()
          .post(root + '/revisions')
          .send({ ...payload(), rules: { ...rules, mappings } })
          .expect(400);
    });
    it('requires newly configured active components without altering existing salary records', async () => {
      const model = connection.model('SalaryComponent');
      await model.create({
        name: 'New Joining Allowance',
        code: 'NEW',
        category: 'allowance',
        status: 'active',
        calculationType: 'fixed',
        calculationBaseType: 'annual_ctc',
        fixedAmountPeriod: 'annual',
        calculationValue: 100,
      });
      await api()
        .post(root + '/revisions')
        .send(payload())
        .expect(400);
      const fresh = await model.findOne({ code: 'NEW' }).lean();
      rules.mappings.push({
        componentId: fresh._id.toString(),
        type: 'taxable',
        legalReference: 'Test-only new-component evidence',
      });
      const saved = await api()
        .post(root + '/revisions')
        .send(payload())
        .expect(201);
      expect(saved.body.revisions[0].rules.mappings.at(-1).componentName).toBe(
        'New Joining Allowance',
      );
      expect(await model.countDocuments()).toBe(6);
    });
    it('creates a later revision without overwriting historical mappings after inactivation', async () => {
      const first = await api()
        .post(root + '/revisions')
        .send(payload())
        .expect(201);
      const snapshot = structuredClone(first.body.revisions[0]);
      const retired = rules.mappings[0].componentId;
      await connection
        .model('SalaryComponent')
        .updateOne(
          { _id: retired },
          { $set: { status: 'inactive', name: 'Renamed inactive record' } },
        );
      rules.mappings = rules.mappings.filter((m) => m.componentId !== retired);
      const next = await api()
        .post(root + '/revisions')
        .send({ ...payload(), version: 2 })
        .expect(201);
      expect(next.body.revisions).toHaveLength(2);
      expect(next.body.revisions[0]).toEqual(snapshot);
      expect(next.body.revisions[0].rules.mappings[0].componentName).toBe(
        'Shift Allowance',
      );
    });
    it('allows one concurrent revision writer and preserves the published version history', async () => {
      const responses = await Promise.all([
        api()
          .post(root + '/revisions')
          .send(payload()),
        api()
          .post(root + '/revisions')
          .send(payload()),
      ]);
      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      const state = (await api().get(root)).body;
      const published = await api()
        .post(root + '/revisions/' + state.revisions[0].id + '/activate')
        .send({ version: state.version })
        .expect(201);
      expect(published.body.published[year.code + ':new']).toBe(
        state.revisions[0].id,
      );
      expect(published.body.revisions).toEqual(state.revisions);
    });
    it('denies ordinary users and platform administrators', async () => {
      for (const role of ['user', 'super_admin']) {
        await api()
          .post(root + '/revisions')
          .set('X-Test-Role', role)
          .send(payload())
          .expect(403);
        await api().get(root).set('X-Test-Role', role).expect(403);
      }
    });
    it('blocks activation of a revision whose component set is no longer current', async () => {
      const saved = await api()
        .post(root + '/revisions')
        .send(payload())
        .expect(201);
      await connection
        .model('SalaryComponent')
        .updateOne(
          { _id: rules.mappings[0].componentId },
          { $set: { status: 'inactive' } },
        );
      await api()
        .post(root + '/revisions/' + saved.body.revisions[0].id + '/activate')
        .send({ version: saved.body.version })
        .expect(400);
      expect((await api().get(root)).body.published).toEqual({});
    });
    it('isolates organization configuration from another organization', async () => {
      await connection
        .collection('org999901_salary_components')
        .insertMany(components);
      await api()
        .put(root + '/years')
        .set('X-Test-Tenant', 'ORG999901')
        .send({ version: 0, createOnly: true, year })
        .expect(200);
      await api()
        .put(root + '/years')
        .set('X-Test-Tenant', 'ORG999902')
        .send({ version: 0, createOnly: true, year })
        .expect(200);
      await api()
        .post(root + '/revisions')
        .set('X-Test-Tenant', 'ORG999901')
        .send(payload())
        .expect(201);
      const other = await api()
        .get(root)
        .set('X-Test-Tenant', 'ORG999902')
        .expect(200);
      expect(other.body.revisions).toEqual([]);
      expect(other.body.years).toHaveLength(1);
      await api()
        .post(root + '/revisions')
        .set('X-Test-Tenant', 'ORG999902')
        .send(payload())
        .expect(400);
      expect(
        (await api().get(root).set('X-Test-Tenant', 'ORG999901')).body
          .revisions,
      ).toHaveLength(1);
    });
  },
);
