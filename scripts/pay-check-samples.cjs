// Synthetic QA samples only. Uses the existing annual salary engine and PDF generator.
const fs = require('node:fs'),
  path = require('node:path');
const { payslipPdf } = require('../dist/run-payroll/payslip');
const {
  SalaryCalculationService,
} = require('../dist/payroll-generator/salary-calculation.service');
const {
  monthlyAmount,
  sumMoney,
} = require('../dist/run-payroll/run-payroll.service');
const { applyPayrollTax } = require('../dist/income-tax/payroll-tax');
const { createCanvas } = require('@napi-rs/canvas');
const output = path.resolve('artifacts/pay-check-samples');
fs.mkdirSync(output, { recursive: true });
const fullAddress = {
  addressLine1: '123 Main Street, Suite 200',
  addressLine2: 'Building A, Floor 2',
  city: 'Dallas',
  state: 'Texas',
  zipCode: '75001',
  country: 'United States',
};
function snapshot(restricted = false, many = false) {
  const id = (n) => String(n).padStart(24, '0');
  const components = [
    ...['BASIC', 'DA', 'RA'].map((code, i) => ({
      _id: id(i + 1),
      code,
      name: ['Basic Salary', 'Dearness Allowance', 'Retaining Allowance'][i],
      category: 'earning',
      calculationType: 'percentage',
      calculationBaseType: 'annual_ctc',
      calculationValue: [40, 10, 15][i],
      showInPayslip: true,
      status: 'active',
    })),
    {
      _id: id(4),
      code: 'ALLOWANCE',
      name: 'Supplementary Allowance',
      category: 'allowance',
      calculationType: 'formula',
      formula:
        'annualGrossWages - annualBasicSalary - annualDearnessAllowance - annualRetainingAllowance' +
        (many ? ' - 12000' : ''),
      calculationBaseType: 'annual_ctc',
      calculationValue: null,
      showInPayslip: true,
      status: 'active',
    },
    {
      _id: id(5),
      code: 'EMP_EPF',
      name: 'Employee EPF',
      category: 'deduction',
      calculationType: 'formula',
      formula: 'annualCoreWages * 12%',
      calculationBaseType: 'annual_ctc',
      calculationValue: null,
      showInPayslip: true,
      status: 'active',
    },
  ];
  if (restricted)
    components.push({
      _id: id(6),
      code: 'PRIVATE',
      name: 'Private internal deduction',
      category: 'deduction',
      calculationType: 'fixed',
      fixedAmountPeriod: 'monthly',
      calculationBaseType: 'annual_ctc',
      calculationValue: 77.77,
      showInPayslip: false,
      status: 'active',
    });
  if (many)
    for (let i = 0; i < 100; i++)
      components.push({
        _id: id(i + 10),
        code: 'EXTRA' + i,
        name:
          'Dynamic allowance ' +
          String(i + 1).padStart(3, '0') +
          ' - Long descriptive component name for pagination and wrapping verification',
        category: 'allowance',
        calculationType: 'fixed',
        fixedAmountPeriod: 'monthly',
        calculationBaseType: 'annual_ctc',
        calculationValue: 10,
        showInPayslip: true,
        status: 'active',
      });
  const salary = new SalaryCalculationService().calculateAnnual(
    1440000,
    components,
    {
      isEpfCeilingApplicable: true,
      wageCap: 180000,
      epfEmployerContributionPercentage: 4,
      epsEmployerContributionPercentage: 8,
      esiEmployerContributionPercentage: 0,
    },
  );
  const a = salary.annual;
  const check = {
    id: 'sample',
    employeeId: 'sample',
    employeeCode: 'EMP001',
    firstName: 'Ada',
    lastName: 'Example',
    grossPay: monthlyAmount(a.annualGrossWages),
    employerContributions: sumMoney(
      [
        a.employerEpfContribution,
        a.employerEpsContribution,
        a.employerEsiContribution,
      ].map(monthlyAmount),
    ),
    deductions: monthlyAmount(a.annualTotalDeductions),
    netPay: monthlyAmount(a.annualNetPay),
    calculation: salary,
    components: salary.components.map((c) => ({
      name: components.find((config) => config._id === c.componentId).name,
      category: c.category,
      amount: c.monthly,
      showInPayslip: c.showInPayslip,
    })),
  };
  return {
    ...applyPayrollTax(check, {
      amount: 1234.56,
      annualTds: 14814.72,
      allocation: Array(12).fill(1234.56),
      yearCode: 'QA',
      regime: 'new',
      calculationId: 'sample',
      inputHash: 'sample',
      configurationVersion: 'sample',
      profileVersion: 1,
      legislation: 'QA',
      monthIndex: 7,
    }),
    tds: 1234.56,
  };
}
(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const results = [];
  for (const [name, address, check] of [
    ['pay-check', fullAddress, snapshot()],
    [
      'reference-layout',
      fullAddress,
      (() => {
        const check = snapshot();
        check.components.find(
          (c) => c.name === 'Supplementary Allowance',
        ).showInPayslip = false;
        const at = check.components.findIndex(
          (c) => c.category === 'deduction',
        );
        check.components.splice(at, 0, {
          name: 'Local tax',
          category: 'deduction',
          amount: 0,
          showInPayslip: true,
        });
        check.components.splice(check.components.length - 1, 0, {
          name: 'Insurance',
          category: 'deduction',
          amount: 0,
          showInPayslip: true,
        });
        return check;
      })(),
    ],
    [
      'without-address-line-2',
      { ...fullAddress, addressLine2: '' },
      snapshot(),
    ],
    [
      'partial-address',
      {
        addressLine1: fullAddress.addressLine1,
        city: 'Dallas',
        country: 'United States',
      },
      snapshot(),
    ],
    ['restricted-components', fullAddress, snapshot(true)],
    ['many-components', fullAddress, snapshot(false, true)],
  ]) {
    const bytes = Buffer.from(
      payslipPdf(
        'Sample Organization, LLC',
        '2026-11',
        '2026-11-30',
        check,
        address,
      ),
      'base64',
    );
    fs.writeFileSync(path.join(output, name + '.pdf'), bytes);
    const loading = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        verbosity: 0,
      }),
      pdf = await loading.promise;
    for (const index of [...new Set([1, pdf.numPages])]) {
      const page = await pdf.getPage(index),
        viewport = page.getViewport({ scale: 1.5 }),
        canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
      await page.render({
        canvas,
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;
      fs.writeFileSync(
        path.join(
          output,
          name + (pdf.numPages > 1 ? '-page-' + index : '') + '.png',
        ),
        canvas.toBuffer('image/png'),
      );
    }
    results.push({
      file: name + '.pdf',
      pages: pdf.numPages,
      grossPay: check.grossPay,
      deductions: check.deductions,
      netPay: check.netPay,
      tds: check.tds,
    });
    await loading.destroy();
  }
  fs.writeFileSync(
    path.join(output, 'sample-results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
