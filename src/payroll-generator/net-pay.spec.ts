import { annualPayroll } from './annual-payroll';
import { CalculationComponent } from './salary-calculation.service';
const component = (
  code: string,
  value: number,
  extra: Partial<CalculationComponent> = {},
): CalculationComponent => ({
  _id: code,
  code,
  category: 'earning',
  status: 'active',
  showInPayslip: true,
  calculationType: 'percentage',
  calculationBaseType: 'annual_ctc',
  calculationValue: value,
  ...extra,
});
const core = () => [
  component('BASIC', 40),
  component('DA', 10),
  component('RA', 15),
];
const rates = {
  epsEmployerContributionPercentage: 8,
  epfEmployerContributionPercentage: 4,
  esiEmployerContributionPercentage: 3,
};
describe('Annual net pay from configured employee deductions', () => {
  it('does not subtract employer contributions a second time when no deductions exist', () => {
    const result = annualPayroll(107500, core(), rates);
    expect(result.annual.annualGrossWages).toBe(100000);
    expect(result.annual.annualNetPay).toBe(100000);
    expect(result.annual.annualTotalDeductions).toBe(0);
  });
  it('sums active deduction cells once, including hidden statutory components and dependent deductions', () => {
    const deductions = [
      component('EPF_EMP', 12, {
        category: 'deduction',
        calculationBaseType: 'salary_component',
        calculationBaseComponentId: 'BASIC',
        showInPayslip: false,
      }),
      component('ESI_EMP', 0.75, {
        category: 'deduction',
        calculationBaseType: 'gross_wages',
      }),
      component('LOAN', 100, {
        category: 'deduction',
        calculationType: 'fixed',
        fixedAmountPeriod: 'monthly',
      }),
      component('INACTIVE', 50, { category: 'deduction', status: 'inactive' }),
    ];
    const result = annualPayroll(107500, [...core(), ...deductions], rates);
    expect(result.annual.annualTotalDeductions).toBe(4800 + 750 + 1200);
    expect(result.annual.annualNetPay).toBe(93250);
    const baseline = annualPayroll(107500, core(), rates);
    for (const [key, value] of Object.entries(baseline.annual))
      if (!['annualNetPay', 'annualTotalDeductions'].includes(key))
        expect(result.annual[key]).toBe(value);
  });
  it('subtracts reported paise precisely and preserves negative net pay instead of clamping it', () => {
    const result = annualPayroll(
      1,
      [
        ...core(),
        component('A', 0.335, {
          category: 'deduction',
          calculationType: 'fixed',
          fixedAmountPeriod: 'annual',
        }),
        component('B', 2, {
          category: 'deduction',
          calculationType: 'fixed',
          fixedAmountPeriod: 'annual',
        }),
      ],
      {
        epsEmployerContributionPercentage: 0,
        epfEmployerContributionPercentage: 0,
        esiEmployerContributionPercentage: 0,
      },
    );
    expect(result.annual.annualTotalDeductions).toBe(2.34);
    expect(result.annual.annualNetPay).toBe(-1.34);
  });
});
