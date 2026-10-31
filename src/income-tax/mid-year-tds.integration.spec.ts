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
import { IncomeTaxService } from './income-tax.service';
import { Ratio } from '../payroll-generator/decimal-ratio';

const integration =
  process.env.RUN_TAX_MONGO_TESTS === '1' ? describe : describe.skip;
integration(
  'Mid-year employee TDS through HTTP, MongoDB and Run Payroll',
  () => {
    let app: INestApplication, db: Connection, runs: RunPayrollService;
    const dbName = `mid_year_tds_test_${process.pid}_${Date.now()}`;
    const code = 'FY2026_27';
    const facts = {
      version: 0,
      tdsApplicable: true,
      resident: true,
      salaryOnly: true,
      panOperative: true,
      fullYearEmployment: false,
      exemptionConditionsConfirmed: true,
      employmentScenario: 'first_job',
      reason: 'QA reviewed employee-provided facts',
    };
    const url = (id: string) => `/employees/${id}/income-tax/${code}`;
    const money = (value: number) => Ratio.of(value).money();
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
        req.account = { id: 'qa-admin', role: 'admin' };
        next();
      });
      await app.init();
      db = app.get(getConnectionToken());
      runs = app.get(RunPayrollService);
      for (const [componentCode, percentage] of [
        ['BASIC', 40],
        ['DA', 10],
        ['RA', 15],
      ] as const)
        await db.model('SalaryComponent').updateOne(
          { code: componentCode },
          {
            $set: {
              calculationValue: percentage,
              calculationBaseType: 'annual_ctc',
            },
          },
        );
      await db.model('StatutoryDeductions').create({
        isEpfCeilingApplicable: true,
        wageCap: 180000,
        epfEmployerContributionPercentage: 4,
        epsEmployerContributionPercentage: 8,
        esiEmployerContributionPercentage: 0,
        epfEmployeeContributionPercentage: 0,
        esiEmployeeContributionPercentage: 0,
      });
      const config = app.get(TaxConfigurationService);
      let state = await config.get();
      state = await config.saveYear(
        {
          version: state.version,
          createOnly: true,
          year: {
            code,
            name: code,
            startDate: '2026-04-01',
            endDate: '2027-03-31',
            legislation: 'Synthetic QA',
            ruleVersion: 'qa',
          },
        },
        'qa-admin',
      );
      state = await config.activateYear(
        code,
        { version: state.version, active: true },
        'qa-admin',
      );
      const components = await app.get(SalaryComponentsService).findAll();
      state = await config.saveRevision(
        {
          version: state.version,
          yearCode: code,
          regime: 'new',
          effectiveDate: '2026-04-01',
          rules: {
            ruleVersion: 'salary-only-v1',
            standardDeduction: 75000,
            rebateLimit: 0,
            maximumRebate: 0,
            rebateMarginalRelief: false,
            cessPercentage: 0,
            surcharge: [],
            surchargeMarginalRelief: false,
            incomeRounding: 'paise',
            liabilityRounding: 'paise',
            minimumAge: 18,
            maximumAge: null,
            slabs: [{ from: 0, to: null, rate: 10 }],
            mappings: components
              .filter(
                (c) => c.status === 'active' && c.category !== 'deduction',
              )
              .map((c) => ({
                componentId: String(c._id),
                type: 'taxable',
                legalReference: 'Synthetic QA',
              })),
            employerContributionsReviewed: true,
            reviewNote: 'Synthetic QA only, not statutory tax advice',
            legalReferences: ['https://www.incometax.gov.in/qa'],
          },
        },
        'qa-admin',
      );
      await config.publish(
        state.revisions.at(-1).id,
        { version: state.version },
        'qa-admin',
      );
    });
    afterAll(async () => {
      if (db?.name === dbName && dbName.startsWith('mid_year_tds_test_'))
        await db.dropDatabase();
      await app?.close();
    });
    async function employee(hireDate = '2026-09-06') {
      const e = await db.model('Employee').create({
        firstName: 'Midyear',
        lastName: 'QA',
        email: randomUUID() + '@example.test',
        dateOfBirth: '1990-01-01',
        hireDate,
        annualCtc: 1600000,
        payFrequency: 'Monthly',
      });
      return String(e._id);
    }
    async function save(id: string, body: any) {
      const saved = (
        await request(app.getHttpServer()).get(url(id)).expect(200)
      ).body.profile;
      let editToken: string | undefined;
      if (saved)
        editToken = (
          await request(app.getHttpServer())
            .post(url(id) + '/edit')
            .send({ version: saved.version })
            .expect(201)
        ).body.editToken;
      return request(app.getHttpServer())
        .put(url(id))
        .send({
          ...facts,
          ...saved,
          ...body,
          version: saved?.version ?? 0,
          editToken,
        })
        .expect(200);
    }
    async function calculate(id: string) {
      const response = await request(app.getHttpServer())
        .post(url(id) + '/calculate')
        .send({});
      if (response.status !== 201)
        throw new Error(JSON.stringify(response.body));
      return response.body;
    }
    it('A: projects seven months for a September first job and uses non-CTC gross', async () => {
      const id = await employee();
      await save(id, {});
      const calculation = await calculate(id),
        p = calculation.inputs.projection,
        r = calculation.result;
      expect(p.eligibleMonthCount).toBe(7);
      expect(p.salary.annual.annualCtc).toBe(933333.33);
      expect(r.currentEmployerGrossWages).toBeLessThan(933333.33);
      expect(r.standardDeduction).toBe(75000);
      expect(r.taxableIncome).toBe(money(r.currentEmployerGrossWages - 75000));
      expect(r.allocation.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
      expect(
        money(r.allocation.reduce((s: number, n: number) => s + n, 0)),
      ).toBe(r.remainingAnnualTds);
      const summary = (
        await request(app.getHttpServer()).get(url(id)).expect(200)
      ).body;
      expect(summary.profile.employmentScenario).toBe('first_job');
      expect(summary.calculationStatus).toBe('calculated');
      expect(summary.latest.snapshot.inputs.projection.employmentScenario).toBe(
        'first_job',
      );
      const payroll = await runs.preview({
        period: '2026-09',
        employeeIds: [id],
        recalculate: true,
      });
      const check = payroll.checks[0];
      expect(check.tds).toBe(r.allocation[5]);
      expect(check.deductions).toBe(
        money(check.existingDeductions + check.tds),
      );
      expect(check.tax.inputHash).toBe(calculation.inputHash);
    });
    it('B, D, E, F: combines verified previous salary, applies one deduction, credits TDS, flags excess and invalidates saved edits', async () => {
      const id = await employee();
      await save(id, {
        employmentScenario: 'job_change',
        previousEmployerGrossWages: 500000,
        previousEmployerExemptWages: 50000,
        previousEmployerTds: 25000,
        previousEmployerExemptionsVerified: true,
      });
      const initial = await calculate(id),
        r = initial.result;
      expect(r.annualGrossWages).toBe(
        money(r.currentEmployerGrossWages + 500000),
      );
      expect(r.taxableIncome).toBe(money(r.annualGrossWages - 50000 - 75000));
      expect(r.annualEstimatedTax).toBe(money(r.taxableIncome / 10));
      expect(r.remainingAnnualTds).toBe(money(r.annualEstimatedTax - 25000));
      await save(id, { previousEmployerTds: r.annualEstimatedTax });
      expect(
        (await request(app.getHttpServer()).get(url(id))).body
          .calculationStatus,
      ).toBe('estimate_saved');
      expect(
        (
          await runs.preview({
            period: '2026-09',
            employeeIds: [id],
            recalculate: true,
          })
        ).checks[0].tds,
      ).toBe(0);
      expect((await calculate(id)).result.allocation).toEqual(
        Array(12).fill(0),
      );
      await save(id, { previousEmployerTds: r.annualEstimatedTax + 100 });
      const excess = (await calculate(id)).result;
      expect(excess.excessTaxCredit).toBe(100);
      expect(excess.annualTds).toBe(0);
      expect(excess.warnings.length).toBeGreaterThan(0);
      await save(id, { previousEmployerGrossWages: 600000 });
      expect(
        (await request(app.getHttpServer()).get(url(id))).body
          .calculationStatus,
      ).toBe('estimate_saved');
      await save(id, { employmentScenario: 'first_job' });
      const first = await calculate(id);
      expect(first.result.previousEmployerTdsCredit).toBe(0);
      expect(first.result.previousEmployerGrossWages).toBe(0);
      expect(first.inputs.projection.previousEmployerExemptWages).toBe(0);
    });
    it('supports a job change with zero previous TDS', async () => {
      const id = await employee();
      await save(id, {
        employmentScenario: 'job_change',
        previousEmployerGrossWages: 500000,
        previousEmployerExemptWages: 0,
        previousEmployerTds: 0,
        previousEmployerExemptionsVerified: false,
      });
      const calculation = await calculate(id);
      expect(calculation.result.previousEmployerTdsCredit).toBe(0);
      expect(calculation.result.remainingAnnualTds).toBe(
        calculation.result.annualEstimatedTax,
      );
    });
    it('persists edited decimal previous-employer amounts and invalidates the old calculation', async () => {
      const id = await employee();
      await save(id, {
        employmentScenario: 'job_change',
        previousEmployerGrossWages: 500000,
        previousEmployerExemptWages: 0,
        previousEmployerTds: 0,
      });
      await calculate(id);
      await save(id, {
        previousEmployerGrossWages: 500000.5,
        previousEmployerExemptWages: 50000.25,
        previousEmployerTds: 25000.75,
        previousEmployerExemptionsVerified: true,
      });
      const reloaded = (
        await request(app.getHttpServer()).get(url(id)).expect(200)
      ).body;
      expect(reloaded.profile.previousEmployerGrossWages).toBe(500000.5);
      expect(reloaded.profile.previousEmployerExemptWages).toBe(50000.25);
      expect(reloaded.profile.previousEmployerTds).toBe(25000.75);
      expect(reloaded.profile.previousEmployerExemptionsVerified).toBe(true);
      expect(reloaded.calculationStatus).toBe('estimate_saved');
      const stored: any = await db
        .model('EmployeeTaxProfile')
        .findOne({ employeeId: id, yearCode: code })
        .lean();
      expect(stored.previousEmployerExemptWages).toBe(50000.25);
      const recalculated = await calculate(id);
      expect(recalculated.result.previousEmployerTdsCredit).toBe(25000.75);
      expect(
        (await request(app.getHttpServer()).get(url(id))).body
          .calculationStatus,
      ).toBe('calculated');
    });
    it('C: April first job retains the full-year projection', async () => {
      const id = await employee('2026-04-01');
      await save(id, {});
      const c = await calculate(id);
      expect(c.inputs.projection.eligibleMonthCount).toBe(12);
      expect(c.inputs.projection.salary.annual).toEqual(c.inputs.salary.annual);
      expect(c.result.remainingPayrollPeriods).toBe(12);
    });
    it('G: credits submitted TDS, excludes processed periods and preserves finalized snapshots', async () => {
      const id = await employee();
      await save(id, {});
      const first = await calculate(id);
      const preview = await runs.preview({
        period: '2026-09',
        employeeIds: [id],
        recalculate: true,
      });
      const draft = await runs.save(
        {
          period: '2026-09',
          employeeIds: [id],
          version: preview.version,
          inputHash: preview.inputHash,
        },
        'qa-admin',
      );
      const submitted = await runs.submit(
        '2026-09',
        {
          version: draft.version,
          paymentDate: '2026-09-30',
          idempotencyKey: randomUUID(),
        },
        'qa-admin',
      );
      const pdf = await runs.pdf('2026-09', id);
      const second = await calculate(id);
      expect(second.result.currentEmployerSubmittedTds).toBe(
        first.result.allocation[5],
      );
      expect(second.result.remainingPayrollPeriods).toBe(6);
      expect(second.result.allocation[5]).toBe(0);
      expect(second.result.remainingAnnualTds).toBe(
        money(first.result.annualTds - first.result.allocation[5]),
      );
      const next = await runs.preview({
        period: '2026-10',
        employeeIds: [id],
        recalculate: true,
      });
      expect(next.checks[0].tds).toBe(second.result.allocation[6]);
      expect((await runs.submission('2026-09')).checks).toEqual(
        submitted.checks,
      );
      expect(await runs.pdf('2026-09', id)).toEqual(pdf);
      await db
        .model('Employee')
        .updateOne({ _id: id }, { $set: { hireDate: '2026-10-06' } });
      expect(
        (await request(app.getHttpServer()).get(url(id))).body
          .calculationStatus,
      ).toBe('estimate_saved');
      expect(
        (
          await runs.preview({
            period: '2026-10',
            employeeIds: [id],
            recalculate: true,
          })
        ).checks[0].tds,
      ).toBe(0);
    });
    it('rejects missing, negative and unverified prior-employer information', async () => {
      const id = await employee();
      for (const extra of [
        {},
        { previousEmployerGrossWages: -1 },
        {
          previousEmployerGrossWages: 500000,
          previousEmployerExemptWages: 50000,
          previousEmployerTds: 0,
          previousEmployerExemptionsVerified: false,
        },
      ]) {
        await request(app.getHttpServer())
          .put(url(id))
          .send({ ...facts, employmentScenario: 'job_change', ...extra })
          .expect(400);
      }
    });
  },
);
