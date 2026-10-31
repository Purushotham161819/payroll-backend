// Run after the sibling Angular production build. All writes use an isolated database.
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
const { RunPayrollModule } = require('../src/run-payroll/run-payroll.module');
const {
  TaxConfigurationService,
} = require('../src/tax-configuration/tax-configuration.service');
const {
  SalaryComponentsService,
} = require('../src/salary-components/salary-components.service');
const { chromium, expect } = require(
  path.join(frontend, 'node_modules/@playwright/test'),
);
const dbName = 'tax_ui_test_' + process.pid + '_' + Date.now(),
  year = new Date().getFullYear(),
  code = 'QA_UI_YEAR';
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
      req.account = { id: 'qa-ui-reviewer', role: 'admin' };
      next();
    });
    await app.init();
    db = app.get(getConnectionToken());
    const tax = app.get(TaxConfigurationService),
      components = await app.get(SalaryComponentsService).findAll();
    let state = await tax.saveYear(
      {
        version: 0,
        createOnly: true,
        year: {
          code,
          name: 'QA UI Financial Year',
          startDate: year + '-01-01',
          endDate: year + '-12-31',
          legislation: 'Isolated UI test fixture',
          ruleVersion: 'qa-ui-v1',
        },
      },
      'qa-ui-reviewer',
    );
    state = await tax.activateYear(
      code,
      { version: state.version, active: true },
      'qa-ui-reviewer',
    );
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
          legalReference: 'QA UI fixture evidence',
        })),
      legalReferences: ['https://www.incometax.gov.in/qa-ui-fixture'],
      reviewNote: 'Synthetic UI verification only',
      employerContributionsReviewed: true,
    };
    state = await tax.saveRevision(
      {
        version: state.version,
        yearCode: code,
        regime: 'new',
        effectiveDate: year + '-01-01',
        rules,
      },
      'qa-ui-reviewer',
    );
    const original = structuredClone(state.revisions[0]);
    state = await tax.publish(
      original.id,
      { version: state.version },
      'qa-ui-reviewer',
    );
    const published = structuredClone(state.published);
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl();
    const root = path.join(frontend, 'dist/payroll-frontend/browser');
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
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://localhost:3000/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/auth/me')
        return route.fulfill({
          json: {
            id: 'qa-ui-reviewer',
            email: 'ui@example.test',
            role: 'admin',
          },
        });
      if (
        url.pathname.startsWith('/settings/tax-configuration') ||
        url.pathname.startsWith('/salary-components')
      )
        return route.fulfill({
          response: await route.fetch({ url: api + url.pathname + url.search }),
        });
      return route.fulfill({ json: { name: 'Isolated QA organization' } });
    });
    await page.goto(
      'http://127.0.0.1:' +
        server.address().port +
        '/settings/tax-configuration',
    );
    await expect(
      page.getByRole('heading', { name: 'Tax Master', exact: true }),
    ).toBeVisible();
    const master = page.locator('section[aria-labelledby="master"]'),
      slabs = page.locator('section[aria-labelledby="slabs"]'),
      surcharge = page.locator('section[aria-labelledby="surcharge"]'),
      mapping = page.locator('section[aria-labelledby="taxability"]');
    await expect(
      master.getByLabel('Standard deduction', { exact: true }),
    ).toHaveValue('0');
    assert.equal(
      await page
        .locator('.settings-tabs')
        .evaluate((el) => getComputedStyle(el).borderBottomWidth),
      '0px',
    );
    await page
      .getByRole('button', { name: 'Add Financial Year', exact: true })
      .click();
    await expect(page.locator('#add-financial-year')).toHaveAttribute(
      'open',
      '',
    );
    await page
      .getByRole('button', { name: 'Add Financial Year', exact: true })
      .click();
    await master.getByLabel('Standard deduction', { exact: true }).fill('123');
    await slabs.getByLabel('Slab rate', { exact: true }).fill('2');
    await master
      .getByRole('button', { name: 'Save Tax Master', exact: true })
      .click();
    await expect(master.getByRole('status')).toContainText('Section saved');
    state = await tax.get();
    assert.equal(state.revisions.at(-1).rules.standardDeduction, 123);
    assert.equal(state.revisions.at(-1).rules.slabs[0].rate, 1);
    await expect(slabs.getByLabel('Slab rate', { exact: true })).toHaveValue(
      '2',
    );
    await master.getByLabel('Standard deduction', { exact: true }).fill('');
    await slabs
      .getByRole('button', { name: 'Save Progressive Slabs', exact: true })
      .click();
    await expect(slabs.getByRole('status')).toContainText('Section saved');
    state = await tax.get();
    assert.equal(state.revisions.at(-1).rules.standardDeduction, 123);
    assert.equal(state.revisions.at(-1).rules.slabs[0].rate, 2);
    await expect(
      master.getByLabel('Standard deduction', { exact: true }),
    ).toHaveValue('');
    await master.getByLabel('Standard deduction', { exact: true }).fill('456');
    await surcharge
      .getByRole('button', { name: 'Add Threshold', exact: true })
      .click();
    await surcharge.getByLabel('Threshold', { exact: true }).fill('5000000');
    await surcharge.getByLabel('Surcharge rate', { exact: true }).fill('10');
    await surcharge
      .getByRole('button', { name: 'Save Surcharge Thresholds', exact: true })
      .click();
    await expect(surcharge.getByRole('status')).toContainText('Section saved');
    const firstName = components.filter(
      (c) => c.status === 'active' && c.category !== 'deduction',
    )[0].name;
    await mapping
      .getByLabel(firstName + ' — legal reference', { exact: true })
      .fill('Updated UI fixture evidence');
    await mapping
      .getByRole('button', { name: 'Save Component Taxability', exact: true })
      .click();
    await expect(
      mapping.getByRole('status').filter({ hasText: 'Section saved' }),
    ).toContainText('Section saved');
    await expect(
      master.getByLabel('Standard deduction', { exact: true }),
    ).toHaveValue('456');
    state = await tax.get();
    assert.equal(state.revisions.length, 5);
    assert.equal(state.revisions.at(-1).rules.standardDeduction, 123);
    assert.deepEqual(state.revisions[0], original);
    assert.deepEqual(state.published, published);
    await page.reload();
    await expect(
      master.getByLabel('Standard deduction', { exact: true }),
    ).toHaveValue('123');
    await expect(slabs.getByLabel('Slab rate', { exact: true })).toHaveValue(
      '2',
    );
    await expect(
      surcharge.getByLabel('Surcharge rate', { exact: true }),
    ).toHaveValue('10');
    const history = page.locator('[aria-label="Tax history"]');
    await history
      .getByRole('button', { name: 'View revision', exact: true })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      history
        .getByRole('button', { name: 'View revision', exact: true })
        .first(),
    ).toBeFocused();
    await history
      .getByRole('button', { name: 'Activate revision', exact: true })
      .first()
      .click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Activation updated' }),
    ).toBeVisible();
    state = await tax.get();
    assert.equal(state.published[code + ':new'], state.revisions.at(-1).id);
    assert.deepEqual(state.revisions[0], original);
    for (let i = 0; i < 7; i++)
      state = await tax.saveRevision(
        {
          version: state.version,
          yearCode: code,
          regime: 'new',
          effectiveDate: year + '-01-01',
          rules: state.revisions.at(-1).rules,
        },
        'qa-ui-reviewer',
      );
    await page.reload();
    await expect(
      page.getByRole('navigation', { name: 'Tax history pages' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(
      page.getByRole('navigation', { name: 'Tax history pages' }),
    ).toContainText('Page 2 of 2');
    const screenshots = path.join(backend, '.tmp/tax-ui');
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, 'desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(screenshots, 'mobile.png'),
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
          sectionSaves: 4,
          persistedRevisions: state.revisions.length,
          publishedSeparately: true,
          retainedUnsavedOtherCards: true,
          immutableOriginal: true,
          pagination: true,
          mobileOverflow: false,
          browserErrors: errors.length,
          screenshots,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db?.name === dbName && dbName.startsWith('tax_ui_test_'))
      await db.dropDatabase();
    await app?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
