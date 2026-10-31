import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import type { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { IncomeTaxService } from '../income-tax/income-tax.service';
import { RunPayrollModule } from './run-payroll.module';
import { RunPayrollService } from './run-payroll.service';
import { TaxConfigurationService } from '../tax-configuration/tax-configuration.service';
import { EmployeeTaxProfileService } from '../employee-tax-profile/employee-tax-profile.service';
const integration =
  process.env.RUN_PAYROLL_MONGO_TESTS === '1' ? describe : describe.skip;
integration(
  'Optional employee TDS payroll regression (isolated MongoDB)',
  () => {
    let app: INestApplication,
      db: Connection,
      runs: RunPayrollService,
      tax: TaxConfigurationService,
      profiles: EmployeeTaxProfileService;
    let blocked: string,
      valid: string,
      stale: string,
      missing: string,
      income: IncomeTaxService,
      originalPdf: Buffer,
      originalHistory: any;
    const year = new Date().getFullYear(),
      period = `${year}-11`,
      previous = `${year}-10`,
      yearCode = 'FY_REVIEW';
    const dbName = `payroll_review_test_${process.pid}_${Date.now()}`;
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
      tax = app.get(TaxConfigurationService);
      income = app.get(IncomeTaxService);
      profiles = app.get(EmployeeTaxProfileService);
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
      await db.model('SalaryComponent').create({
        name: 'QA deduction',
        code: 'QA_DEDUCT',
        category: 'deduction',
        status: 'active',
        calculationType: 'fixed',
        calculationBaseType: 'annual_ctc',
        fixedAmountPeriod: 'monthly',
        calculationValue: 5000,
        showInPayslip: true,
      });
      await db.model('StatutoryDeductions').create({
        wageCap: 180000,
        epfEmployerContributionPercentage: 0,
        epsEmployerContributionPercentage: 0,
        esiEmployerContributionPercentage: 0,
        epfEmployeeContributionPercentage: 0,
        esiEmployeeContributionPercentage: 0,
      });
      const employees = await db.model('Employee').create([
        {
          firstName: 'Needs',
          employeeId: 'EMP001',
          lastName: 'Review',
          email: 'review@example.test',
          dateOfBirth: '1990-01-01',
          hireDate: `${year - 1}-01-01`,
          annualCtc: 2400000,
          payFrequency: 'Monthly',
        },
        {
          firstName: 'Valid',
          employeeId: 'EMP003',
          lastName: 'Employee',
          email: 'valid@example.test',
          dateOfBirth: '1990-01-01',
          hireDate: `${year - 1}-01-01`,
          annualCtc: 2400000,
          payFrequency: 'Monthly',
        },
      ]);
      [blocked, valid] = employees.map((e) => e._id.toString());
      const before = await runs.preview({
        period: previous,
        employeeIds: [blocked],
        recalculate: true,
      });
      const draft = await runs.save(
        {
          period: previous,
          employeeIds: [blocked],
          version: 0,
          inputHash: before.inputHash,
        },
        'qa-admin',
      );
      await runs.submit(
        previous,
        {
          version: draft.version,
          paymentDate: `${year}-10-31`,
          idempotencyKey: randomUUID(),
        },
        'qa-admin',
      );
      originalPdf = await runs.pdf(previous, blocked);
      originalHistory = await runs.history(blocked);
      let state = await tax.saveYear(
        {
          version: 0,
          createOnly: true,
          year: {
            code: yearCode,
            name: 'QA Review Year',
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`,
            legislation: 'Isolated test fixture',
            ruleVersion: 'qa-v1',
          },
        },
        'qa-admin',
      );
      state = await tax.activateYear(
        yearCode,
        { version: state.version, active: true },
        'qa-admin',
      );
      const components = await db
        .model('SalaryComponent')
        .find({ category: { $ne: 'deduction' }, status: 'active' })
        .lean();
      state = await tax.saveRevision(
        {
          version: state.version,
          yearCode,
          regime: 'new',
          effectiveDate: `${year}-01-01`,
          rules: {
            ruleVersion: 'salary-only-v1',
            standardDeduction: 0,
            rebateLimit: 0,
            maximumRebate: 0,
            rebateMarginalRelief: true,
            cessPercentage: 0,
            surcharge: [],
            surchargeMarginalRelief: true,
            incomeRounding: 'nearest-ten-ignore-paise',
            liabilityRounding: 'nearest-ten-ignore-paise',
            minimumAge: 0,
            maximumAge: null,
            slabs: [{ from: 0, to: null, rate: 1 }],
            mappings: components.map((c) => ({
              componentId: c._id.toString(),
              type: 'taxable',
              legalReference: 'QA ordinary-wage fixture evidence',
            })),
            employerContributionsReviewed: true,
            reviewNote: 'QA only: no exemptions/additional employer amounts',
            legalReferences: [
              'https://www.incometaxindia.gov.in/Documents/Act/Income-tax-Act-2025.pdf',
            ],
          },
        },
        'qa-admin',
      );
      await tax.publish(
        state.revisions[0].id,
        { version: state.version },
        'qa-admin',
      );
      const extra = await db.model('Employee').create(
        ['Estimate', 'Missing'].map((firstName, index) => ({
          employeeId: index === 0 ? 'EMP002' : 'EMP004',
          firstName,
          lastName: 'Employee',
          email: firstName.toLowerCase() + '@example.test',
          dateOfBirth: '1990-01-01',
          hireDate: String(year - 1) + '-01-01',
          annualCtc: 2400000,
          payFrequency: 'Monthly',
        })),
      );
      [stale, missing] = extra.map((e) => e._id.toString());
      for (const id of [valid, stale, missing])
        await profiles.save(
          id,
          yearCode,
          {
            version: 0,
            regime: 'new',
            tdsApplicable: true,
            resident: true,
            salaryOnly: true,
            panOperative: true,
            fullYearEmployment: true,
            exemptionConditionsConfirmed: false,
          },
          'qa-admin',
        );
      await income.project(valid, yearCode, 'qa-admin');
      await income.project(stale, yearCode, 'qa-admin');
      const old = await profiles.get(stale, yearCode);
      await profiles.save(
        stale,
        yearCode,
        { ...old, reason: 'Changed inputs require recalculation' },
        'qa-admin',
      );
    });
    afterAll(async () => {
      if (db?.name === dbName && dbName.startsWith('payroll_review_test_'))
        await db.dropDatabase();
      await app?.close();
    });

    async function finalize(ids: string[], target = period) {
      const preview = await runs.preview({
        period: target,
        employeeIds: ids,
        recalculate: true,
      });
      const draft = await runs.save(
        {
          period: target,
          employeeIds: ids,
          version: preview.version,
          inputHash: preview.inputHash,
          paymentDate: target + '-28',
          tds: 999999,
        } as any,
        'qa-admin',
      );
      const reopened = await runs.preview({ period: target, employeeIds: ids });
      expect(reopened.stale).toBe(false);
      expect(reopened.checks).toEqual(draft.checks);
      const submitted = await runs.submit(
        target,
        {
          version: draft.version,
          paymentDate: target + '-28',
          idempotencyKey: randomUUID(),
        },
        'qa-admin',
      );
      expect(submitted.status).toBe('Submitted');
      expect((await runs.pdf(target, ids[0])).subarray(0, 4).toString()).toBe(
        '%PDF',
      );
      return submitted;
    }
    it('honors the stored calculation status rather than merely the existence of a saved amount', async () => {
      const model = db.model('EmployeeTdsCalculation');
      const record: any = await model.findOne({ employeeId: valid }).lean();
      try {
        await model.updateOne(
          { _id: record._id },
          { $set: { 'snapshot.status': 'estimate_saved' } },
        );
        const preview = await runs.preview({
          period,
          employeeIds: [valid],
          recalculate: true,
        });
        expect(preview.checks[0].tds).toBe(0);
        expect(preview.checks[0].tdsCalculationStatus).toBe('estimate_saved');
        expect((await income.summary(valid, yearCode)).calculationStatus).toBe(
          'estimate_saved',
        );
      } finally {
        await model.updateOne(
          { _id: record._id },
          { $set: { 'snapshot.status': 'calculated' } },
        );
      }
    });
    it('processes an employee with no TDS configuration and earlier payroll without TDS', async () => {
      const summary = await income.summary(blocked, yearCode);
      expect(summary.calculationStatus).toBe('not_configured');
      const submitted = await finalize([blocked]);
      expect(submitted.checks[0]).toMatchObject({
        tds: 0,
        tdsCalculationStatus: 'not_configured',
        grossPay: 200000,
        deductions: 5000,
        netPay: 195000,
      });
      expect(submitted.validationIssues).toBeUndefined();
      expect(await runs.pdf(previous, blocked)).toEqual(originalPdf);
      expect(
        (await runs.history(blocked)).filter((c: any) => c.period === previous),
      ).toEqual(originalHistory);
    });
    it('uses zero for an estimate after input changes and for a missing calculation, without creating calculations during payroll', async () => {
      expect((await income.summary(stale, yearCode)).calculationStatus).toBe(
        'estimate_saved',
      );
      expect((await income.summary(missing, yearCode)).calculationStatus).toBe(
        'not_calculated',
      );
      const before = await income.history(stale, yearCode);
      const submitted = await finalize([stale, missing]);
      for (const check of submitted.checks)
        expect(check).toMatchObject({
          tds: 0,
          deductions: 5000,
          netPay: 195000,
        });
      expect(await income.history(stale, yearCode)).toEqual(before);
      expect(await income.history(missing, yearCode)).toEqual([]);
    });
    it('deducts the authoritative calculated 2000 once and preserves Gross and employer amounts', async () => {
      const summary = await income.summary(valid, yearCode);
      expect(summary.calculationStatus).toBe('calculated');
      expect(summary.calculationStatusLabel).toBe('Calculated');
      const submitted = await finalize([valid]);
      expect(submitted.checks[0]).toMatchObject({
        grossPay: 200000,
        employerContributions: 0,
        tds: 2000,
        existingDeductions: 5000,
        deductions: 7000,
        netPay: 193000,
        tdsCalculationStatus: 'calculated',
      });
      expect(submitted.checks[0].tax.calculationId).toBe(
        summary.latest._id.toString(),
      );
      expect(
        submitted.checks[0].components.filter(
          (c: any) => c.name === 'Income Tax / TDS',
        ),
      ).toHaveLength(1);
      const pdf = (await runs.pdf(period, valid)).toString('latin1');
      expect(pdf).toContain('Income Tax / TDS');
      expect(pdf).toContain('2000.00');
    });
    it('includes all optional TDS states in mixed totals, persists zero amounts and protects finalized employees', async () => {
      const submitted = await finalize(
        [blocked, stale, missing, valid],
        String(year) + '-12',
      );
      expect(submitted.totalPayrollCost).toBe(800000);
      expect(submitted.totals).toEqual({
        employerContributions: 0,
        deductions: 22000,
        netPay: 778000,
      });
      expect(
        submitted.checks.reduce((sum: number, c: any) => sum + c.tds, 0),
      ).toBe(2000);
      const stored: any = await db
        .model('PayrollRun')
        .findOne({ period: String(year) + '-12', status: 'Submitted' })
        .lean();
      expect(stored.checks.map((c: any) => c.tds).sort()).toEqual([
        0, 0, 0, 2000,
      ]);
      await expect(
        runs.save(
          {
            period: String(year) + '-12',
            employeeIds: [valid],
            version: submitted.version,
            inputHash: submitted.inputHash,
          },
          'qa-admin',
        ),
      ).rejects.toThrow();
      expect(await runs.pdf(previous, blocked)).toEqual(originalPdf);
    });
    it('permits a fresh calculation after earlier zero-TDS payroll and permits explicitly disabling TDS afterwards', async () => {
      await income.project(missing, yearCode, 'qa-admin');
      const submitted = await finalize([missing], String(year) + '-04');
      expect(submitted.checks[0].tds).toBe(2000);
      const previous: any = await profiles.get(missing, yearCode);
      await profiles.save(
        missing,
        yearCode,
        {
          ...previous,
          tdsApplicable: false,
          reason: 'Optional TDS disabled in isolated fixture',
        },
        'qa-admin',
      );
      const next = await runs.preview({
        period: String(year) + '-05',
        employeeIds: [missing],
        recalculate: true,
      });
      expect(next.checks[0].tds).toBe(0);
      expect(next.checks[0].tdsCalculationStatus).toBe('disabled');
      expect(next.validationIssues).toBeUndefined();
      expect((await runs.submission(String(year) + '-04')).checks).toEqual(
        submitted.checks,
      );
    });
    it('does not deduct a saved amount after salary changes and requires ordinary draft refresh before submission', async () => {
      const target = String(year) + '-06';
      const preview = await runs.preview({
        period: target,
        employeeIds: [valid],
        recalculate: true,
      });
      const draft = await runs.save(
        {
          period: target,
          employeeIds: [valid],
          version: preview.version,
          inputHash: preview.inputHash,
        },
        'qa-admin',
      );
      await db
        .model('Employee')
        .updateOne({ _id: valid }, { $set: { annualCtc: 2520000 } });
      expect((await income.summary(valid, yearCode)).calculationStatus).toBe(
        'estimate_saved',
      );
      await expect(
        runs.submit(
          target,
          {
            version: draft.version,
            paymentDate: target + '-28',
            idempotencyKey: randomUUID(),
          },
          'qa-admin',
        ),
      ).rejects.toThrow('changed');
      const fresh = await runs.preview({
        period: target,
        employeeIds: [valid],
        recalculate: true,
      });
      expect(fresh.checks[0].tds).toBe(0);
      await finalize([valid], target);
      await db
        .model('Employee')
        .updateOne({ _id: valid }, { $set: { annualCtc: 2400000 } });
      await income.project(valid, yearCode, 'qa-admin');
    });
    (process.env.RUN_PAYROLL_BROWSER_TESTS === '1' ? it : it.skip)(
      'completes the production Angular workflow in Edge against isolated real payroll APIs',
      async () => {
        const path = require('node:path');
        const frontendRoot = path.resolve(
          __dirname,
          '../../../payroll-frontend',
        );
        const { chromium, expect: browserExpect } = require(
          path.join(frontendRoot, 'node_modules/@playwright/test'),
        );
        const http = require('node:http'),
          fs = require('node:fs');
        const root = path.join(frontendRoot, 'dist/payroll-frontend/browser');
        const server = http.createServer((req: any, res: any) => {
          const file = path.resolve(
            root,
            '.' + new URL(req.url, 'http://localhost').pathname,
          );
          if (!file.startsWith(path.resolve(root) + path.sep)) {
            res.writeHead(403);
            res.end();
            return;
          }
          const target =
            fs.existsSync(file) && fs.statSync(file).isFile()
              ? file
              : path.join(root, 'index.html');
          res.setHeader(
            'Content-Type',
            target.endsWith('.js')
              ? 'text/javascript'
              : target.endsWith('.css')
                ? 'text/css'
                : 'text/html',
          );
          res.end(fs.readFileSync(target));
        });
        let browser: any;
        try {
          await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve),
          );
          await app.listen(0, '127.0.0.1');
          const api = await app.getUrl();
          browser = await chromium.launch({
            channel: 'msedge',
            headless: true,
          });
          const page = await browser.newPage({ locale: 'en-IN' }),
            errors: string[] = [];
          page.on('pageerror', (error: Error) => errors.push(error.message));
          await page.route('http://localhost:3000/**', async (route: any) => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname === '/auth/me')
              return route.fulfill({
                json: {
                  id: 'qa-admin',
                  email: 'qa@example.test',
                  role: 'admin',
                },
              });
            if (pathname === '/employees')
              return route.fulfill({
                json: await db.model('Employee').find().lean(),
              });
            if (pathname.startsWith('/payroll/'))
              return route.fulfill({
                response: await route.fetch({
                  url:
                    api +
                    new URL(route.request().url()).pathname +
                    new URL(route.request().url()).search,
                }),
              });
            return route.fulfill({
              json: { name: 'Isolated QA organization' },
            });
          });
          await page.goto(
            `http://127.0.0.1:${server.address().port}/payroll/run?employees=${blocked},${stale},${missing},${valid}`,
          );
          await page
            .getByLabel('Pay Period', { exact: true })
            .selectOption(`${year}-07`);
          await browserExpect(
            page.getByText('Needs Review', { exact: true }),
          ).toHaveCount(0);
          await browserExpect(
            page.locator('[aria-label="Total NET Pay"]'),
          ).toContainText('778,000.00');
          await browserExpect(
            page.getByRole('columnheader', { name: 'TDS', exact: true }),
          ).toBeVisible();
          await browserExpect(
            page
              .getByRole('row')
              .filter({
                has: page.getByRole('checkbox', {
                  name: 'Include Estimate Employee in payroll',
                  exact: true,
                }),
              }),
          ).toContainText('Estimate saved');
          await page
            .getByRole('checkbox', {
              name: 'Include Valid Employee in payroll',
              exact: true,
            })
            .uncheck();
          await browserExpect(
            page.locator('[aria-label="Total NET Pay"]'),
          ).toContainText('585,000.00');
          await page
            .getByRole('checkbox', {
              name: 'Include Valid Employee in payroll',
              exact: true,
            })
            .check();
          await browserExpect(
            page.locator('[aria-label="Total NET Pay"]'),
          ).toContainText('778,000.00');
          await page
            .getByLabel('Payment Date', { exact: true })
            .fill(`${year}-07-28`);
          await page.getByRole('button', { name: 'Save', exact: true }).click();
          await browserExpect(
            page.getByText('Payroll draft saved.', { exact: false }),
          ).toBeVisible();
          await page.reload();
          await page
            .getByLabel('Pay Period', { exact: true })
            .selectOption(`${year}-07`);
          await browserExpect(
            page.getByRole('checkbox', {
              name: 'Include Valid Employee in payroll',
              exact: true,
            }),
          ).toBeChecked();
          await browserExpect(
            page.getByLabel('Payment Date', { exact: true }),
          ).toHaveValue(`${year}-07-28`);
          await page
            .getByRole('button', { name: 'Submit', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Confirm submission', exact: true })
            .click();
          await browserExpect(
            page.getByRole('heading', {
              name: 'Payroll Submitted Successfully',
            }),
          ).toBeVisible();
          expect(
            await db.model('PayrollRun').countDocuments({
              period: `${year}-07`,
              status: 'Submitted',
              'checks.employeeId': valid,
            }),
          ).toBe(1);
          expect(
            (await runs.pdf(`${year}-07`, valid)).subarray(0, 4).toString(),
          ).toBe('%PDF');
          expect(await runs.pdf(previous, blocked)).toEqual(originalPdf);
          expect(errors).toEqual([]);
        } finally {
          await browser?.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      60000,
    );
  },
);
