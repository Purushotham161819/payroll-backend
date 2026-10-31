import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SalaryCalculationService } from '../payroll-generator/salary-calculation.service';
import type { CalculationComponent } from '../payroll-generator/salary-calculation.service';
import { calculateAnnualTax } from './tax-engine';
import type { TaxRules } from './tax.types';
import { monthlyAmount } from '../run-payroll/run-payroll.service';
import { Ratio } from '../payroll-generator/decimal-ratio';

// Expected values were worked independently, slab by slab, in the manual guide.
// Rates: ITA2025 ss19,156,202,516; enacted FA2026 s3 and Schedule I Part III.
// These QA-only zero-employer-contribution fixtures never configure a customer.
const cases: any[] = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'test/fixtures/fy2026-27-salary-only.json'),
    'utf8',
  ),
);
const components: CalculationComponent[] = [
  {
    _id: 'basic',
    code: 'BASIC',
    category: 'earning',
    calculationType: 'percentage',
    calculationBaseType: 'gross_wages',
    calculationValue: 40,
    status: 'active',
    showInPayslip: true,
  },
  {
    _id: 'da',
    code: 'DA',
    category: 'earning',
    calculationType: 'percentage',
    calculationBaseType: 'salary_component',
    calculationBaseComponentId: 'basic',
    calculationValue: 10,
    status: 'active',
    showInPayslip: true,
  },
  {
    _id: 'ra',
    code: 'RA',
    category: 'earning',
    calculationType: 'percentage',
    calculationBaseType: 'salary_component',
    calculationBaseComponentId: 'basic',
    calculationValue: 15,
    status: 'active',
    showInPayslip: true,
  },
  {
    _id: 'qa-deduction',
    code: 'QA_OTHER',
    category: 'deduction',
    calculationType: 'fixed',
    calculationBaseType: 'annual_ctc',
    fixedAmountPeriod: 'monthly',
    calculationValue: 5000,
    status: 'active',
    showInPayslip: true,
  },
];
describe('Independently worked FY2026–27 salary-only manual guide fixtures', () => {
  it.each(cases)('$id: CTC $annualCtc under $regime regime', (c) => {
    const isNew = c.regime === 'new';
    const rules: TaxRules = {
      ruleVersion: 'salary-only-v1',
      standardDeduction: isNew ? 75000 : 50000,
      rebateLimit: isNew ? 1200000 : 500000,
      maximumRebate: isNew ? 60000 : 12500,
      rebateMarginalRelief: isNew,
      cessPercentage: 4,
      surcharge: [
        { threshold: 5000000, rate: 10 },
        { threshold: 10000000, rate: 15 },
        { threshold: 20000000, rate: 25 },
        ...(!isNew ? [{ threshold: 50000000, rate: 37 }] : []),
      ],
      surchargeMarginalRelief: true,
      incomeRounding: 'nearest-ten-ignore-paise',
      liabilityRounding: 'nearest-ten-ignore-paise',
      minimumAge: 0,
      maximumAge: isNew ? null : 59,
      slabs: isNew
        ? [0, 400000, 800000, 1200000, 1600000, 2000000, 2400000].map(
            (from, i, a) => ({ from, to: a[i + 1] ?? null, rate: i * 5 }),
          )
        : [
            { from: 0, to: 250000, rate: 0 },
            { from: 250000, to: 500000, rate: 5 },
            { from: 500000, to: 1000000, rate: 20 },
            { from: 1000000, to: null, rate: 30 },
          ],
      mappings: components
        .filter((c) => c.category !== 'deduction')
        .map((c) => ({
          componentId: c._id.toString(),
          type: 'taxable',
          legalReference:
            'QA ordinary cash wages: Income-tax Act, 2025, section 16(a)',
        })),
      employerContributionsReviewed: true,
      reviewNote:
        'Isolated zero-employer QA wage fixture; no exemptions or other income',
      legalReferences: [
        'https://www.incometaxindia.gov.in/Documents/Act/Income-tax-Act-2025.pdf',
        'https://egazette.gov.in/WriteReadData/2026/271439.pdf',
      ],
    };
    const salary = new SalaryCalculationService().calculateAnnual(
      c.annualCtc,
      components,
      {
        epfEmployerContributionPercentage: 0,
        epsEmployerContributionPercentage: 0,
        esiEmployerContributionPercentage: 0,
      },
    );
    expect(salary.annual.annualGrossWages).toBe(c.annualCtc);
    const result = calculateAnnualTax(salary, rules);
    for (const key of [
      'standardDeduction',
      'taxableIncome',
      'taxBeforeRebate',
      'rebate',
      'rebateMarginalRelief',
      'surcharge',
      'surchargeMarginalRelief',
      'cess',
      'annualTds',
      'monthlyTds',
    ] as const)
      expect(result[key]).toBe(c[key]);
    expect(result.slabs.map((s) => s.tax)).toEqual(c.slabTaxes);
    expect(result.allocation[11]).toBe(c.finalTds);
    expect(
      result.allocation
        .reduce((s, n) => s.add(Ratio.of(n)), Ratio.of(0))
        .money(),
    ).toBe(c.annualTds);
    expect(monthlyAmount(salary.annual.annualGrossWages)).toBe(c.monthlyGross);
    expect(monthlyAmount(salary.annual.annualTotalDeductions)).toBe(
      c.existingDeductions,
    );
    expect(
      Ratio.of(monthlyAmount(salary.annual.annualNetPay))
        .sub(Ratio.of(c.monthlyTds))
        .money(),
    ).toBe(c.netPay);
    expect(
      Ratio.of(monthlyAmount(salary.annual.annualNetPay))
        .sub(Ratio.of(c.finalTds))
        .money(),
    ).toBe(c.finalNetPay);
  });
});
