import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { RunPayrollModule } from '../run-payroll/run-payroll.module';
import { RunPayrollService } from '../run-payroll/run-payroll.service';
import { TaxConfigurationService } from '../tax-configuration/tax-configuration.service';
import { EmployeeTaxProfileService } from '../employee-tax-profile/employee-tax-profile.service';
import { IncomeTaxService } from './income-tax.service';
import type { TaxRules } from './tax.types';
import { tenantContext } from '../organizations/tenant-context';
import { TaxAdministratorGuard } from './tax.controller';

const integration =
  process.env.RUN_TAX_MONGO_TESTS === '1' ? describe : describe.skip;
integration(
  'Independent TDS feature with real MongoDB and existing payroll workflow',
  () => {
    let connection: Connection,
      module: any,
      runs: RunPayrollService,
      tax: IncomeTaxService,
      configuration: TaxConfigurationService,
      profiles: EmployeeTaxProfileService;
    let id: string, year: number, yearCode: string, employee: any, initial: any;
    let dbName: string;
    beforeAll(async () => {
      dbName = `tds_feature_test_${process.pid}_${Date.now()}`;
      module = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
            dbName,
            serverSelectionTimeoutMS: 3000,
          }),
          RunPayrollModule,
        ],
      }).compile();
      await module.init();
      connection = module.get(getConnectionToken());
      runs = module.get(RunPayrollService);
      tax = module.get(IncomeTaxService);
      configuration = module.get(TaxConfigurationService);
      profiles = module.get(EmployeeTaxProfileService);
      year = new Date().getFullYear();
      yearCode = `FY${year}`;
      const components = connection.model('SalaryComponent');
      for (const [code, value] of [
        ['BASIC', 40],
        ['DA', 10],
        ['RA', 15],
      ] as const)
        await components.updateOne(
          { code },
          {
            $set: {
              name: code,
              code,
              category: 'earning',
              calculationType: 'percentage',
              calculationBaseType: 'annual_ctc',
              calculationValue: value,
              status: 'active',
              showInPayslip: true,
            },
          },
          { upsert: true },
        );
      await components.create({
        name: 'Employee deduction',
        code: 'DEDUCT',
        category: 'deduction',
        calculationType: 'fixed',
        fixedAmountPeriod: 'monthly',
        calculationBaseType: 'annual_ctc',
        calculationValue: 5000,
        status: 'active',
        showInPayslip: true,
      });
      await connection.model('StatutoryDeductions').create({
        epfEmployerContributionPercentage: 4,
        epsEmployerContributionPercentage: 8,
        esiEmployerContributionPercentage: 0,
        epfEmployeeContributionPercentage: 0,
        esiEmployeeContributionPercentage: 0,
        wageCap: 180000,
      });
      employee = await connection.model('Employee').create({
        firstName: 'Tax',
        lastName: 'Fixture',
        email: 'tds@example.test',
        dateOfBirth: '1990-01-01',
        hireDate: `${year - 1}-01-01`,
        annualCtc: 2400000,
        payFrequency: 'Monthly',
      });
      id = employee._id.toString();
      initial = await runs.preview({
        period: `${year}-01`,
        employeeIds: [id],
        recalculate: true,
      });
    });
    afterAll(async () => {
      if (connection?.name === dbName && dbName.startsWith('tds_feature_test_'))
        await connection.dropDatabase();
      await module?.close();
    });
    it('creates serialized, non-overlapping financial years and rejects stale writes', async () => {
      let state = await configuration.saveYear(
        {
          version: 0,
          year: {
            code: yearCode,
            name: `Fixture ${year}`,
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`,
            legislation: 'Explicit synthetic fixture',
            ruleVersion: 'fixture-v1',
          },
        },
        'admin',
      );
      await expect(
        configuration.saveYear({ version: 0, year: {} }, 'admin'),
      ).rejects.toThrow('Reload');
      await expect(
        configuration.saveYear(
          {
            version: state.version,
            year: {
              code: 'OVERLAP',
              name: 'Overlap',
              startDate: `${year}-04-01`,
              endDate: `${year + 1}-03-31`,
              legislation: 'Fixture',
              ruleVersion: 'fixture',
            },
          },
          'admin',
        ),
      ).rejects.toThrow('overlap');
      state = await configuration.activateYear(
        yearCode,
        { version: state.version, active: true },
        'admin',
      );
      expect(state.years.filter((y: any) => y.active)).toHaveLength(1);
    });
    it('publishes immutable complete configuration and creates an audited employee profile', async () => {
      const components = await connection
        .model('SalaryComponent')
        .find({ category: 'earning' })
        .lean();
      const rules: TaxRules = {
        ruleVersion: 'salary-only-v1',
        standardDeduction: 50000,
        rebateLimit: 500000,
        maximumRebate: 12500,
        rebateMarginalRelief: false,
        cessPercentage: 4,
        surcharge: [{ threshold: 5000000, rate: 10 }],
        surchargeMarginalRelief: true,
        incomeRounding: 'nearest-ten-ignore-paise',
        liabilityRounding: 'nearest-ten-ignore-paise',
        minimumAge: 0,
        maximumAge: 59,
        slabs: [
          { from: 0, to: 250000, rate: 0 },
          { from: 250000, to: 500000, rate: 5 },
          { from: 500000, to: 1000000, rate: 20 },
          { from: 1000000, to: null, rate: 30 },
        ],
        mappings: components.map((c: any) => ({
          componentId: c._id.toString(),
          type: 'taxable',
          legalReference: 'Synthetic test fixture',
        })),
        employerContributionsReviewed: true,
        reviewNote: 'Synthetic fixture, not production statutory data',
        legalReferences: [
          'https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1',
        ],
      };
      let state = await configuration.get();
      state = await configuration.saveRevision(
        {
          version: state.version,
          yearCode,
          regime: 'old',
          effectiveDate: `${year}-01-01`,
          rules,
        },
        'admin',
      );
      state = await configuration.publish(
        state.revisions[0].id,
        { version: state.version },
        'admin',
      );
      expect(state.audit.at(-1).action).toContain('publish');
      await profiles.save(
        id,
        yearCode,
        {
          version: 0,
          regime: 'old',
          tdsApplicable: false,
          resident: true,
          salaryOnly: true,
          panOperative: true,
          fullYearEmployment: true,
          exemptionConditionsConfirmed: false,
          reason: 'Disabled acceptance fixture',
        },
        'admin',
      );
      const disabled = await runs.preview({
        period: `${year}-01`,
        employeeIds: [id],
        recalculate: true,
      });
      expect(disabled.checks[0]).toMatchObject({
        grossPay: initial.checks[0].grossPay,
        deductions: initial.checks[0].deductions,
        netPay: initial.checks[0].netPay,
        tds: 0,
        tdsCalculationStatus: 'disabled',
      });
      expect(disabled.totals).toEqual(initial.totals);
      expect(disabled.inputHash).toEqual(initial.inputHash);
      await profiles.save(
        id,
        yearCode,
        {
          version: 1,
          regime: 'old',
          tdsApplicable: true,
          resident: true,
          salaryOnly: true,
          panOperative: true,
          fullYearEmployment: true,
          exemptionConditionsConfirmed: false,
        },
        'admin',
      );
      const result = await tax.project(id, yearCode, 'admin');
      expect(result.status).toBe('calculated');
      expect(await tax.history(id, yearCode)).toHaveLength(1);
    });
    let draft: any, finalized: any;
    it('preserves actual existing Gross and statutory outputs, applies TDS once, and saves exact snapshots', async () => {
      const preview: any = await runs.preview({
        period: `${year}-01`,
        employeeIds: [id],
        recalculate: true,
      });
      const before = initial.checks[0],
        after = preview.checks[0];
      expect(after.grossPay).toBe(before.grossPay);
      expect(after.employerContributions).toBe(before.employerContributions);
      expect(after.calculation).toEqual(before.calculation);
      expect(after.existingDeductions).toBe(before.deductions);
      expect(after.tds).toBeGreaterThan(0);
      expect(after.netPay).toBeCloseTo(before.netPay - after.tds, 2);
      expect(after.deductions).toBeCloseTo(before.deductions + after.tds, 2);
      const again = await runs.preview({
        period: `${year}-01`,
        employeeIds: [id],
        recalculate: true,
      });
      expect(again.checks).toEqual(preview.checks);
      draft = await runs.save(
        {
          period: preview.period,
          employeeIds: [id],
          version: 0,
          inputHash: preview.inputHash,
        },
        'admin',
      );
      expect(draft.checks[0].tax).toEqual(after.tax);
    });
    it('rejects cross-year payment dates and idempotently finalizes one TDS deduction and PDF', async () => {
      await expect(
        runs.submit(
          draft.period,
          {
            version: draft.version,
            paymentDate: `${year + 1}-01-01`,
            idempotencyKey: randomUUID(),
          },
          'admin',
        ),
      ).rejects.toThrow('outside');
      const body = {
        version: draft.version,
        paymentDate: `${year}-01-31`,
        idempotencyKey: randomUUID(),
      };
      const [first, retry] = await Promise.all([
        runs.submit(draft.period, body, 'admin'),
        runs.submit(draft.period, body, 'admin'),
      ]);
      finalized = first;
      expect(retry.checks).toEqual(first.checks);
      expect(first.checks[0].tds).toBe(draft.checks[0].tds);
      expect((await runs.pdf(draft.period, id)).subarray(0, 4).toString()).toBe(
        '%PDF',
      );
      expect(await runs.history(id)).toHaveLength(1);
      expect((await tax.summary(id, yearCode)).submittedTds).toBe(
        draft.checks[0].tds,
      );
    });
    it('preserves finalized checks after profile changes and uses zero until recalculated', async () => {
      const previous: any = await profiles.get(id, yearCode);
      await profiles.save(
        id,
        yearCode,
        { ...previous, reason: 'Profile review' },
        'admin',
      );
      const next = await runs.preview({
        period: `${year}-02`,
        employeeIds: [id],
        recalculate: true,
      });
      expect(next.checks[0].tds).toBe(0);
      expect(next.checks[0].tdsCalculationStatus).toBe('estimate_saved');
      expect(next.checks[0].netPay).toBe(initial.checks[0].netPay);
      expect((await runs.submission(draft.period)).checks).toEqual(
        finalized.checks,
      );
    });
    it('isolates organization configuration and employee ownership', async () => {
      await tenantContext.run({ organizationId: 'ORG999991' }, async () => {
        expect((await configuration.get()).years).toEqual([]);
        await expect(profiles.get(id, yearCode)).rejects.toThrow(
          'organization',
        );
      });
    });
    it('denies tax data access to non-administrators', () => {
      const guard = new TaxAdministratorGuard();
      const context = (role: string) =>
        ({
          switchToHttp: () => ({ getRequest: () => ({ account: { role } }) }),
        }) as any;
      expect(() => guard.canActivate(context('user'))).toThrow('Administrator');
      expect(() => guard.canActivate(context('super_admin'))).toThrow(
        'Administrator',
      );
      expect(guard.canActivate(context('admin'))).toBe(true);
    });
  },
);
