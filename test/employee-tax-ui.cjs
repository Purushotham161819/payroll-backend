const path = require('node:path'),
  fs = require('node:fs'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '..'),
  frontend = path.resolve(backend, '../payroll-frontend');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(backend, 'tsconfig.json'),
});
require('reflect-metadata');
const { Test } = require('@nestjs/testing'),
  { MongooseModule, getConnectionToken } = require('@nestjs/mongoose');
const { RunPayrollModule } = require('../src/run-payroll/run-payroll.module'),
  { RunPayrollService } = require('../src/run-payroll/run-payroll.service');
const {
    TaxConfigurationService,
  } = require('../src/tax-configuration/tax-configuration.service'),
  {
    SalaryComponentsService,
  } = require('../src/salary-components/salary-components.service');
const { chromium, expect } = require(
  path.join(frontend, 'node_modules/@playwright/test'),
);
const { randomUUID } = require('node:crypto');
const dbName = 'employee_tax_browser_test_' + process.pid + '_' + Date.now(),
  year = new Date().getFullYear(),
  code = 'QA_EMPLOYEE_YEAR',
  nextCode = 'QA_FOLLOWING_YEAR';
let app, db, browser, server;
(async () => {
  try {
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
    app.use((req, _res, next) => {
      req.account = { id: 'qa-admin', role: 'admin' };
      next();
    });
    await app.init();
    db = app.get(getConnectionToken());
    const tax = app.get(TaxConfigurationService),
      runs = app.get(RunPayrollService);
    for (const [code, value] of [
      ['BASIC', 40],
      ['DA', 10],
      ['RA', 15],
    ])
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
    const employee = await db.model('Employee').create({
        employeeId: 'EMP001',
        firstName: 'Profile',
        lastName: 'QA Employee',
        email: 'profile@example.test',
        dateOfBirth: '1990-01-01',
        hireDate: year - 1 + '-01-01',
        annualCtc: 2400000,
        payFrequency: 'Monthly',
      }),
      id = employee._id.toString();
    const rules = {
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
          legalReference: 'QA employee profile fixture',
        })),
      legalReferences: ['https://www.incometax.gov.in/qa-employee-profile'],
      reviewNote: 'Synthetic browser fixture only',
      employerContributionsReviewed: true,
    };
    for (const [y, n] of [
      [code, year],
      [nextCode, year + 1],
    ]) {
      let state = await tax.get();
      state = await tax.saveYear(
        {
          version: state.version,
          createOnly: true,
          year: {
            code: y,
            name: y,
            startDate: n + '-01-01',
            endDate: n + '-12-31',
            legislation: 'Isolated QA employee profile',
            ruleVersion: 'qa-v1',
          },
        },
        'qa-admin',
      );
      state = await tax.saveRevision(
        {
          version: state.version,
          yearCode: y,
          regime: 'new',
          effectiveDate: n + '-01-01',
          rules,
        },
        'qa-admin',
      );
      await tax.publish(
        state.revisions.at(-1).id,
        { version: state.version },
        'qa-admin',
      );
    }
    let state = await tax.get();
    await tax.activateYear(
      code,
      { version: state.version, active: true },
      'qa-admin',
    );
    const legacy = await runs.preview({
      period: year + '-01',
      employeeIds: [id],
      recalculate: true,
    });
    assert.equal(legacy.checks[0].tds, 0);
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl(),
      root = path.join(frontend, 'dist/payroll-frontend/browser');
    server = http.createServer((req, res) => {
      const file = path.resolve(
        root,
        '.' + new URL(req.url, 'http://localhost').pathname,
      );
      if (!file.startsWith(root + path.sep)) {
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
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    let calculations = 0,
      employeeReads = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://localhost:3000/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/auth/me')
        return route.fulfill({
          json: { id: 'qa-admin', email: 'qa@example.test', role: 'admin' },
        });
      if (url.pathname === '/employees') {
        employeeReads++;
        return route.fulfill({
          json: await db.model('Employee').find().lean(),
        });
      }
      if (url.pathname.endsWith('/calculate')) calculations++;
      if (
        url.pathname.startsWith('/employees/') ||
        url.pathname.startsWith('/payroll/') ||
        url.pathname.startsWith('/settings/tax-configuration') ||
        url.pathname.startsWith('/salary-components')
      )
        return route.fulfill({
          response: await route.fetch({ url: api + url.pathname + url.search }),
        });
      return route.fulfill({ json: { name: 'QA organization' } });
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/employees/' + id + '?tab=tax');
    await expect(
      page.getByRole('tab', { name: 'Income Tax / TDS', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    assert.deepEqual(await page.getByRole('tab').allTextContents(), [
      ' Employee Details ',
      ' Employment History ',
      ' Income Tax / TDS ',
      ' Pay Checks ',
    ]);
    const card = page.locator(
      'section[aria-labelledby="employee-tax-profile"]',
    );
    await expect(
      card.getByRole('combobox', { name: 'Financial year', exact: true }),
    ).toBeEnabled();
    await expect(card.getByLabel('Tax regime', { exact: true })).toHaveValue(
      'New Regime',
    );
    assert.equal(calculations, 0);
    await card.getByLabel('TDS applicable', { exact: true }).check();
    for (const label of [
      'Confirmed Indian tax resident',
      'Salary-only income',
      'PAN operative and verified',
      'Full-year employment confirmed',
    ])
      await card.getByLabel(label, { exact: true }).check();
    await card
      .getByLabel('Reason / review note', { exact: true })
      .fill('Saved browser QA facts');
    await card
      .getByRole('button', { name: 'Save Tax Profile', exact: true })
      .click();
    await expect(
      card.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole('combobox', { name: 'Financial year', exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByLabel('Reason / review note', { exact: true }),
    ).toBeDisabled();
    const initialReads = employeeReads;
    await page
      .getByRole('tab', { name: 'Employment History', exact: true })
      .click();
    await page
      .getByRole('tab', { name: 'Income Tax / TDS', exact: true })
      .click();
    await expect(
      card.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeVisible();
    assert.equal(employeeReads, initialReads);
    assert.equal(calculations, 0);
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(
      card.getByLabel('Reason / review note', { exact: true }),
    ).toBeEnabled();
    await expect(
      card.getByRole('combobox', { name: 'Financial year', exact: true }),
    ).toBeDisabled();
    await card
      .getByLabel('Reason / review note', { exact: true })
      .fill('Cancel this edit');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      card.getByLabel('Reason / review note', { exact: true }),
    ).toHaveValue('Saved browser QA facts');
    await card
      .getByRole('button', { name: 'Calculate Annual TDS', exact: true })
      .click();
    await expect(card).toContainText('Calculated');
    assert.equal(calculations, 1);
    await expect(
      page.getByRole('heading', {
        name: 'Saved Annual Tax Breakdown',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', {
        name: 'Salary taxability breakdown',
        exact: true,
      }),
    ).toContainText('Basic Salary');
    const preview = await runs.preview({
      period: year + '-01',
      employeeIds: [id],
      recalculate: true,
    });
    assert.equal(preview.checks[0].tds, 2000);
    const draft = await runs.save(
      {
        period: preview.period,
        employeeIds: [id],
        version: preview.version,
        inputHash: preview.inputHash,
      },
      'qa-admin',
    );
    const submitted = await runs.submit(
        preview.period,
        {
          version: draft.version,
          paymentDate: year + '-01-28',
          idempotencyKey: randomUUID(),
        },
        'qa-admin',
      ),
      pdf = await runs.pdf(preview.period, id);
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await card
      .getByLabel('Reason / review note', { exact: true })
      .fill('Changed browser QA facts');
    await card
      .getByRole('button', { name: 'Save Tax Profile', exact: true })
      .click();
    await expect(card).toContainText('Estimate saved');
    await page
      .getByRole('button', { name: 'View Calculation History', exact: true })
      .click();
    await expect(
      page.locator('[aria-label="Saved tax calculations"]'),
    ).toContainText('Profile v1');
    assert.equal(calculations, 1);
    const stale = await runs.preview({
      period: year + '-02',
      employeeIds: [id],
      recalculate: true,
    });
    assert.equal(stale.checks[0].tds, 0);
    assert.deepEqual(
      (await runs.submission(preview.period)).checks,
      submitted.checks,
    );
    assert.deepEqual(await runs.pdf(preview.period, id), pdf);
    await card
      .getByRole('button', { name: 'Change Financial Year', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'New financial year', exact: true })
      .selectOption(nextCode);
    await page
      .getByRole('button', {
        name: 'Confirm Change Financial Year',
        exact: true,
      })
      .click();
    await expect(
      card.getByRole('combobox', { name: 'Financial year', exact: true }),
    ).toHaveValue(nextCode);
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      card.getByRole('combobox', { name: 'Financial year', exact: true }),
    ).toHaveValue(code);
    await page.reload();
    await expect(
      page.getByRole('tab', { name: 'Income Tax / TDS', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      card.getByRole('combobox', { name: 'Financial year', exact: true }),
    ).toBeDisabled();
    assert.equal(calculations, 1);
    const output = path.join(backend, '.tmp/employee-tax-ui');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, 'desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(output, 'mobile.png'),
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          database: dbName,
          explicitCalculations: calculations,
          tabContextPreserved: true,
          yearLocked: true,
          cancelRestores: true,
          calculatedTds: 2000,
          staleTds: 0,
          historicalPdfUnchanged: true,
          directRefresh: true,
          mobileOverflow: false,
          browserErrors: errors.length,
          screenshots: output,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db?.name === dbName && dbName.startsWith('employee_tax_browser_test_'))
      await db.dropDatabase();
    await app?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
