import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { RunPayrollModule } from '../run-payroll/run-payroll.module';
import { RunPayrollService } from '../run-payroll/run-payroll.service';
import { TaxConfigurationService } from '../tax-configuration/tax-configuration.service';
import { SalaryComponentsService } from '../salary-components/salary-components.service';
import { EmployeeTaxProfileService } from './employee-tax-profile.service';
import { tenantContext } from '../organizations/tenant-context';
const integration =
  process.env.RUN_TAX_MONGO_TESTS === '1' ? describe : describe.skip;
integration('Employee TDS profile explicit editing workflow', () => {
  let app: INestApplication,
    db: Connection,
    tax: TaxConfigurationService,
    profiles: EmployeeTaxProfileService,
    runs: RunPayrollService,
    id: string,
    other: string,
    firstPdf: Buffer,
    firstSnapshot: any,
    fixtureRules: any;
  const year = new Date().getFullYear(),
    code = 'QA_PROFILE_YEAR',
    nextCode = 'QA_NEXT_YEAR',
    period = year + '-01',
    dbName = 'employee_tax_ui_test_' + process.pid + '_' + Date.now();
  const facts = {
    version: 0,
    tdsApplicable: true,
    resident: true,
    salaryOnly: true,
    panOperative: true,
    fullYearEmployment: true,
    exemptionConditionsConfirmed: false,
    reason: 'QA reviewed facts',
  };
  const endpoint = () => '/employees/' + id + '/income-tax/' + code;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
          dbName,
          serverSelectionTimeoutMS: 3000,
        }),
        RunPayrollModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.account = {
        id: req.headers['x-test-actor'] ?? 'qa-admin',
        role: req.headers['x-test-role'] ?? 'admin',
      };
      next();
    });
    await app.init();
    db = app.get(getConnectionToken());
    tax = app.get(TaxConfigurationService);
    profiles = app.get(EmployeeTaxProfileService);
    runs = app.get(RunPayrollService);
    for (const [code, value] of [
      ['BASIC', 40],
      ['DA', 10],
      ['RA', 15],
    ] as const)
      await db.model('SalaryComponent').updateOne(
        { code },
        {
          $set: {
            calculationValue: value,
            calculationBaseType: 'annual_ctc',
          },
        },
      );
    const components = await app.get(SalaryComponentsService).findAll();
    await db.model('StatutoryDeductions').create({
      wageCap: 180000,
      epfEmployerContributionPercentage: 0,
      epsEmployerContributionPercentage: 0,
      esiEmployerContributionPercentage: 0,
      epfEmployeeContributionPercentage: 0,
      esiEmployeeContributionPercentage: 0,
    });
    const employees = await db.model('Employee').create(
      ['EMP001', 'EMP002'].map((employeeId) => ({
        employeeId,
        firstName: employeeId,
        lastName: 'QA Employee',
        email: employeeId + '@example.test',
        dateOfBirth: '1990-01-01',
        hireDate: year - 1 + '-01-01',
        annualCtc: 2400000,
        payFrequency: 'Monthly',
      })),
    );
    [id, other] = employees.map((e) => e._id.toString());
    fixtureRules = {
      ruleVersion: 'salary-only-v1',
      standardDeduction: 0,
      rebateLimit: 0,
      maximumRebate: 0,
      cessPercentage: 0,
      rebateMarginalRelief: false,
      surchargeMarginalRelief: false,
      incomeRounding: 'paise',
      liabilityRounding: 'paise',
      minimumAge: 0,
      maximumAge: null,
      slabs: [{ from: 0, to: null, rate: 1 }],
      surcharge: [],
      mappings: components
        .filter((c) => c.status === 'active' && c.category !== 'deduction')
        .map((c) => ({
          componentId: c._id.toString(),
          type: 'taxable',
          legalReference: 'Synthetic profile workflow fixture',
        })),
      legalReferences: ['https://www.incometax.gov.in/qa-profile-workflow'],
      reviewNote: 'QA only',
      employerContributionsReviewed: true,
    };
    for (const [yearCode, n] of [
      [code, year],
      [nextCode, year + 1],
    ] as const) {
      let state = await tax.get();
      state = await tax.saveYear(
        {
          version: state.version,
          createOnly: true,
          year: {
            code: yearCode,
            name: yearCode,
            startDate: n + '-01-01',
            endDate: n + '-12-31',
            legislation: 'QA only',
            ruleVersion: 'qa-profile-v1',
          },
        },
        'qa-admin',
      );
      state = await tax.activateYear(
        yearCode,
        { version: state.version, active: true },
        'qa-admin',
      );
      state = await tax.saveRevision(
        {
          version: state.version,
          yearCode,
          regime: 'new',
          effectiveDate: n + '-01-01',
          rules: fixtureRules,
        },
        'qa-admin',
      );
      await tax.publish(
        state.revisions.at(-1).id,
        { version: state.version },
        'qa-admin',
      );
    }
    const state = await tax.get();
    await tax.activateYear(
      code,
      { version: state.version, active: true },
      'qa-admin',
    );
  });
  afterAll(async () => {
    if (db?.name === dbName && dbName.startsWith('employee_tax_ui_test_'))
      await db.dropDatabase();
    await app?.close();
  });
  it('derives the sole published regime and does not calculate when reading an unconfigured employee', async () => {
    const summary = await request(app.getHttpServer())
      .get(endpoint())
      .expect(200);
    expect(summary.body.regimeSelection.regime).toBe('new');
    expect(summary.body.calculationStatus).toBe('not_configured');
    expect(summary.body.latest).toBeNull();
    const preview = await runs.preview({
      period,
      employeeIds: [other],
      recalculate: true,
    });
    expect(preview.checks[0].tds).toBe(0);
    const saved = await request(app.getHttpServer())
      .put(endpoint())
      .send(facts)
      .expect(200);
    expect(saved.body.regime).toBe('new');
    expect(saved.body.version).toBe(1);
    expect(await db.model('EmployeeTdsCalculation').countDocuments()).toBe(0);
  });
  it('rejects ordinary PUT updates, edited financial years, regime injection and invalid edit permissions', async () => {
    await request(app.getHttpServer())
      .put(endpoint())
      .send({ ...facts, version: 1, reason: 'Bypass' })
      .expect(409);
    const permission = await request(app.getHttpServer())
      .post(endpoint() + '/edit')
      .send({ version: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .put(endpoint())
      .send({
        ...facts,
        version: 1,
        editToken: permission.body.editToken,
        yearCode: nextCode,
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(endpoint())
      .send({
        ...facts,
        version: 1,
        regime: 'old',
        editToken: permission.body.editToken,
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(endpoint())
      .set('x-test-actor', 'another-admin')
      .send({ ...facts, version: 1, editToken: permission.body.editToken })
      .expect(409);
    await request(app.getHttpServer())
      .put(endpoint())
      .send({
        ...facts,
        version: 1,
        editToken: permission.body.editToken + 'x',
      })
      .expect(409);
    expect((await profiles.get(id, code)).version).toBe(1);
  });
  it('saves an explicit edit and consumes its version-bound permission while retaining the audit', async () => {
    const permission = await request(app.getHttpServer())
      .post(endpoint() + '/edit')
      .send({ version: 1 })
      .expect(201);
    const body = {
      ...facts,
      version: 1,
      editToken: permission.body.editToken,
      reason: 'Explicit reviewed change',
    };
    const saved = await request(app.getHttpServer())
      .put(endpoint())
      .send(body)
      .expect(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.audit).toHaveLength(2);
    await request(app.getHttpServer())
      .put(endpoint())
      .send({ ...body, version: 2 })
      .expect(409);
  });
  it('calculates explicitly, applies the authoritative amount in payroll and keeps reads/edit entry free of recalculation', async () => {
    await request(app.getHttpServer())
      .post(endpoint() + '/calculate')
      .send({})
      .expect(201);
    const summary = await request(app.getHttpServer())
      .get(endpoint())
      .expect(200);
    expect(summary.body.calculationStatus).toBe('calculated');
    const preview = await runs.preview({
      period,
      employeeIds: [id],
      recalculate: true,
    });
    expect(preview.checks[0].tds).toBe(2000);
    const draft = await runs.save(
      {
        period,
        employeeIds: [id],
        version: preview.version,
        inputHash: preview.inputHash,
      },
      'qa-admin',
    );
    firstSnapshot = await runs.submit(
      period,
      {
        version: draft.version,
        paymentDate: period + '-28',
        idempotencyKey: randomUUID(),
      },
      'qa-admin',
    );
    firstPdf = await runs.pdf(period, id);
    await request(app.getHttpServer()).get(endpoint()).expect(200);
    await request(app.getHttpServer())
      .post(endpoint() + '/edit')
      .send({ version: 2 })
      .expect(201);
    expect(await db.model('EmployeeTdsCalculation').countDocuments()).toBe(1);
    expect((await profiles.get(id, code)).version).toBe(2);
  });
  it('marks the saved calculation stale after a saved edit and preserves finalized snapshots and PDFs', async () => {
    const permission = await request(app.getHttpServer())
      .post(endpoint() + '/edit')
      .send({ version: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .put(endpoint())
      .send({
        ...facts,
        version: 2,
        editToken: permission.body.editToken,
        reason: 'New reviewed facts',
      })
      .expect(200);
    const summary = await request(app.getHttpServer())
      .get(endpoint())
      .expect(200);
    expect(summary.body.calculationStatus).toBe('estimate_saved');
    expect(summary.body.latest).not.toBeNull();
    const preview = await runs.preview({
      period: year + '-02',
      employeeIds: [id],
      recalculate: true,
    });
    expect(preview.checks[0].tds).toBe(0);
    expect((await runs.submission(period)).checks).toEqual(
      firstSnapshot.checks,
    );
    expect(await runs.pdf(period, id)).toEqual(firstPdf);
  });
  it('requires a separate year-change permission and creates a distinct profile without changing the source', async () => {
    const target = '/employees/' + id + '/income-tax/' + nextCode;
    await request(app.getHttpServer()).put(target).send(facts).expect(409);
    const source = await profiles.get(id, code);
    const permission = await request(app.getHttpServer())
      .post(target + '/change-year')
      .send({ fromYearCode: code, fromVersion: 3 })
      .expect(201);
    await request(app.getHttpServer())
      .put(target)
      .send({ ...facts, changeYearToken: permission.body.changeYearToken })
      .expect(200);
    expect(await profiles.get(id, code)).toEqual(source);
    expect(await profiles.list(id)).toHaveLength(2);
    expect(await db.model('EmployeeTdsCalculation').countDocuments()).toBe(1);
    expect(await runs.pdf(period, id)).toEqual(firstPdf);
  });
  it('rejects ambiguous new profiles and preserves the existing configured regime when both are published', async () => {
    let state = await tax.get();
    state = await tax.saveRevision(
      {
        version: state.version,
        yearCode: code,
        regime: 'old',
        effectiveDate: year + '-01-01',
        rules: fixtureRules,
      },
      'qa-admin',
    );
    await tax.publish(
      state.revisions.at(-1).id,
      { version: state.version },
      'qa-admin',
    );
    const summary = await request(app.getHttpServer())
      .get('/employees/' + other + '/income-tax/' + code)
      .expect(200);
    expect(summary.body.regimeSelection.regime).toBeNull();
    expect(summary.body.regimeSelection.message).toContain('Both');
    await request(app.getHttpServer())
      .put('/employees/' + other + '/income-tax/' + code)
      .send({ ...facts, regime: 'new' })
      .expect(400);
    expect(
      (await request(app.getHttpServer()).get(endpoint()).expect(200)).body
        .regimeSelection.regime,
    ).toBe('new');
  });
  it('rejects missing configuration and cross-organization access without creating profiles', async () => {
    const state = await tax.get();
    await tax.saveYear(
      {
        version: state.version,
        createOnly: true,
        year: {
          code: 'QA_UNPUBLISHED',
          name: 'QA unpublished',
          startDate: year + 2 + '-01-01',
          endDate: year + 2 + '-12-31',
          legislation: 'QA only',
          ruleVersion: 'qa-v1',
        },
      },
      'qa-admin',
    );
    await request(app.getHttpServer())
      .put('/employees/' + other + '/income-tax/QA_UNPUBLISHED')
      .send(facts)
      .expect(400);
    await request(app.getHttpServer())
      .put('/employees/' + other + '/income-tax/UNKNOWN_YEAR')
      .send(facts)
      .expect(400);
    expect(await profiles.list(other)).toEqual([]);
    await tenantContext.run({ organizationId: 'ORG999992' }, async () => {
      await expect(profiles.list(id)).rejects.toThrow('organization');
      await expect(profiles.beginEdit(id, code, 3, 'qa-admin')).rejects.toThrow(
        'organization',
      );
    });
  });
  it('retains administrator authorization for profile discovery and editing', async () => {
    await request(app.getHttpServer())
      .get('/employees/' + id + '/income-tax')
      .set('x-test-role', 'user')
      .expect(403);
    await request(app.getHttpServer())
      .post(endpoint() + '/edit')
      .set('x-test-role', 'user')
      .send({ version: 3 })
      .expect(403);
  });
});
