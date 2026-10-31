import {
  allocateMonthly,
  calculateAnnualTax,
  validateRules,
} from './tax-engine';
import type { TaxRules } from './tax.types';
import { Ratio } from '../payroll-generator/decimal-ratio';

// Explicit test fixtures, never production defaults. FY2025-26 ordinary salary
// reference: incometax.gov.in/iec/foportal/help/individual/return-applicable-1
export function fixtureRules(): TaxRules {
  return {
    ruleVersion: 'salary-only-v1',
    standardDeduction: 75000,
    rebateLimit: 1200000,
    maximumRebate: 60000,
    rebateMarginalRelief: true,
    cessPercentage: 4,
    surcharge: [
      { threshold: 5000000, rate: 10 },
      { threshold: 10000000, rate: 15 },
      { threshold: 20000000, rate: 25 },
    ],
    surchargeMarginalRelief: true,
    incomeRounding: 'nearest-ten-ignore-paise',
    liabilityRounding: 'nearest-ten-ignore-paise',
    minimumAge: 0,
    maximumAge: null,
    employerContributionsReviewed: true,
    legalReferences: [
      'https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1',
    ],
    reviewNote:
      'Test fixture: ordinary salary with no taxable employer additions.',
    slabs: [0, 400000, 800000, 1200000, 1600000, 2000000, 2400000].map(
      (from, i, a) => ({ from, to: a[i + 1] ?? null, rate: i * 5 }),
    ),
    mappings: [
      { componentId: 'salary', type: 'taxable', legalReference: 'Salary' },
    ],
  };
}
const salary = (gross: number) => ({
  annual: { annualCtc: gross + 12000, annualGrossWages: gross },
  components: [
    {
      componentId: 'salary',
      code: 'SALARY',
      category: 'earning',
      annual: gross,
    },
  ],
});
describe('Independent annual tax arithmetic', () => {
  it.each([
    [1275000, 0],
    [1675000, 124800],
    [2475000, 312000],
  ])('computes new-regime gross %s', (gross, expected) => {
    const r = calculateAnnualTax(salary(gross), fixtureRules());
    expect(r.annualTds).toBe(expected);
    expect(r.annualCtc).toBe(gross + 12000);
  });
  it('applies old-regime parameters independently', () => {
    const rules = {
      ...fixtureRules(),
      standardDeduction: 50000,
      rebateLimit: 500000,
      maximumRebate: 12500,
      rebateMarginalRelief: false,
      slabs: [
        { from: 0, to: 250000, rate: 0 },
        { from: 250000, to: 500000, rate: 5 },
        { from: 500000, to: 1000000, rate: 20 },
        { from: 1000000, to: null, rate: 30 },
      ],
    };
    expect(calculateAnnualTax(salary(550000), rules).annualTds).toBe(0);
    expect(calculateAnnualTax(salary(1050000), rules).annualTds).toBe(117000);
  });
  it('applies rebate marginal relief before cess', () => {
    const r = calculateAnnualTax(salary(1275010), fixtureRules());
    expect(r.rebate).toBe(0);
    expect(r.rebateMarginalRelief).toBeGreaterThan(0);
    expect(r.annualTds).toBe(10);
  });
  it.each([5000000, 10000000, 20000000])(
    'caps tax plus surcharge at threshold %s',
    (threshold) => {
      const r = calculateAnnualTax(salary(threshold + 75010), fixtureRules());
      const at = calculateAnnualTax(salary(threshold + 75000), fixtureRules());
      expect(r.surchargeMarginalRelief).toBeGreaterThan(0);
      expect(
        r.taxBeforeRebate + r.surcharge - r.surchargeMarginalRelief,
      ).toBeCloseTo(
        at.taxBeforeRebate + at.surcharge - at.surchargeMarginalRelief + 10,
        2,
      );
    },
  );
  it('keeps exact allocation and places residual in the final month', () => {
    for (const value of [0, 0.01, 1, 100.01, 999999.99]) {
      const allocation = allocateMonthly(value);
      expect(allocation).toHaveLength(12);
      expect(
        allocation.reduce((s, n) => s.add(Ratio.of(n)), Ratio.of(0)).money(),
      ).toBe(value);
      expect(new Set(allocation.slice(0, 11)).size).toBe(1);
    }
    expect(() => allocateMonthly(10, 'Weekly')).toThrow();
    expect(() => allocateMonthly(0.001)).toThrow();
  });
  it('applies explicit exemptions without treating CTC as salary', () => {
    const rules = fixtureRules();
    rules.standardDeduction = 0;
    rules.mappings = [
      {
        componentId: 'salary',
        type: 'partial',
        taxablePercentage: 75,
        conditions: 'Reviewed fixture',
        legalReference: 'Fixture',
      },
    ];
    const r = calculateAnnualTax(salary(2000000), rules);
    expect(r.totalTaxableSalary).toBe(1500000);
    rules.mappings[0] = {
      componentId: 'salary',
      type: 'exempt',
      conditions: 'Fixture',
      legalReference: 'Fixture',
    };
    expect(calculateAnnualTax(salary(1000), rules).taxableIncome).toBe(0);
  });
  it('rejects incomplete, overlapping, gapped or invalid rules', () => {
    for (const slabs of [
      [{ from: 1, to: null, rate: 10 }],
      [
        { from: 0, to: 100, rate: 0 },
        { from: 99, to: null, rate: 10 },
      ],
      [
        { from: 0, to: 100, rate: 0 },
        { from: 101, to: null, rate: 10 },
      ],
      [{ from: 0, to: null, rate: 101 }],
    ])
      expect(() => validateRules({ ...fixtureRules(), slabs })).toThrow();
    expect(() =>
      calculateAnnualTax(salary(100), { ...fixtureRules(), mappings: [] }),
    ).toThrow('mapping missing');
    expect(() =>
      validateRules({ ...fixtureRules(), legalReferences: [] }),
    ).toThrow();
  });
  it('uses historical inputs independently without mutating configuration', () => {
    const rules = fixtureRules(),
      original = JSON.stringify(rules);
    const current = calculateAnnualTax(salary(2000000), rules);
    const historical = calculateAnnualTax(salary(2000000), {
      ...rules,
      standardDeduction: 50000,
    });
    expect(current.taxableIncome).not.toBe(historical.taxableIncome);
    expect(JSON.stringify(rules)).toBe(original);
  });
  it('rounds statutory income after ignoring paise', () => {
    expect(
      calculateAnnualTax(salary(1275004.99), fixtureRules()).taxableIncome,
    ).toBe(1200000);
    expect(
      calculateAnnualTax(salary(1275005), fixtureRules()).taxableIncome,
    ).toBe(1200010);
  });
});
