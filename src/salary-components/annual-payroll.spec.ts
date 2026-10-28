import { annualPayroll, EmployerRates } from './annual-payroll';
import { CalculationComponent } from './salary-calculation.service';

const c = (
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
const core = () => [c('BASIC', 40), c('DA', 10), c('RA', 15)];
const rates: EmployerRates = {
  epsEmployerContributionPercentage: 8,
  epfEmployerContributionPercentage: 4,
  esiEmployerContributionPercentage: 3,
};
const noRates: EmployerRates = {
  epsEmployerContributionPercentage: 0,
  epfEmployerContributionPercentage: 0,
  esiEmployerContributionPercentage: 0,
};
const allowance = (
  code: string,
  value: number,
  extra: Partial<CalculationComponent> = {},
) =>
  c(code, value, {
    category: 'allowance',
    calculationBaseType: 'gross_wages',
    ...extra,
  });
function verify(
  result: ReturnType<typeof annualPayroll>,
  r: EmployerRates,
  components: CalculationComponent[],
) {
  const k = result.annual;
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.021);
  near(k.employerEpsContribution, (k.annualCoreWages * r.epsEmployerContributionPercentage) / 100);
  near(k.employerEpfContribution, (k.annualCoreWages * r.epfEmployerContributionPercentage) / 100);
  near(k.employerEsiContribution, (k.annualComplianceWageBase * r.esiEmployerContributionPercentage) / 100);
  near(k.annualGrossWages, k.annualCtc - k.employerEpsContribution - k.employerEpfContribution - k.employerEsiContribution);
  near(k.annualBasicSalary, k.annualGrossWages * 0.4);
  near(k.annualDearnessAllowance, k.annualBasicSalary * 0.1);
  near(k.annualRetainingAllowance, k.annualBasicSalary * 0.15);
  near(k.annualCoreWages, k.annualBasicSalary + k.annualDearnessAllowance + k.annualRetainingAllowance);
  near(
    k.annualTotalAllowances,
    result.components
      .filter(
        (c) =>
          components.find((s) => s.code === c.code)?.category === 'allowance',
      )
      .reduce((s, c) => s + c.annual, 0),
  );
  near(k.annualExcessAllowance, Math.max(0, k.annualTotalAllowances - 0.5 * k.annualGrossWages));
  near(k.annualComplianceWageBase, k.annualCoreWages + k.annualExcessAllowance);
  expect(result.diagnostics.equationResidual).toBe(0);
}
describe('Annual Excel payroll system', () => {
  it.each([undefined, null, '107500', NaN, Infinity, -1])(
    'rejects invalid employee Annual CTC: %s',
    (ctc) => {
      expect(() => annualPayroll(ctc as number, core(), rates)).toThrow(
        'Invalid or missing Annual CTC.',
      );
    },
  );
  it.each([
    [
      'zero excess',
      107500,
      rates,
      [allowance('A', 20)],
      {
        employerEpsContribution: 4000,
        employerEpfContribution: 2000,
        employerEsiContribution: 1500,
        annualGrossWages: 100000,
        annualBasicSalary: 40000,
        annualDearnessAllowance: 4000,
        annualRetainingAllowance: 6000,
        annualCoreWages: 50000,
        annualTotalAllowances: 20000,
        annualExcessAllowance: 0,
        annualComplianceWageBase: 50000,
      },
    ],
    [
      'positive excess',
      108100,
      rates,
      [allowance('A', 70)],
      {
        employerEpsContribution: 4000,
        employerEpfContribution: 2000,
        employerEsiContribution: 2100,
        annualGrossWages: 100000,
        annualBasicSalary: 40000,
        annualDearnessAllowance: 4000,
        annualRetainingAllowance: 6000,
        annualCoreWages: 50000,
        annualTotalAllowances: 70000,
        annualExcessAllowance: 20000,
        annualComplianceWageBase: 70000,
      },
    ],
    [
      'zero rates and boundary',
      100000,
      noRates,
      [allowance('A', 50)],
      {
        employerEpsContribution: 0,
        employerEpfContribution: 0,
        employerEsiContribution: 0,
        annualGrossWages: 100000,
        annualBasicSalary: 40000,
        annualDearnessAllowance: 4000,
        annualRetainingAllowance: 6000,
        annualCoreWages: 50000,
        annualTotalAllowances: 50000,
        annualExcessAllowance: 0,
        annualComplianceWageBase: 50000,
      },
    ],
    [
      'component dependency and multiple allowances',
      107500,
      rates,
      [
        allowance('A', 50, {
          calculationBaseType: 'salary_component',
          calculationBaseComponentId: 'BASIC',
        }),
        allowance('B', 50, {
          calculationBaseType: 'salary_component',
          calculationBaseComponentId: 'A',
        }),
      ],
      {
        employerEpsContribution: 4000,
        employerEpfContribution: 2000,
        employerEsiContribution: 1500,
        annualGrossWages: 100000,
        annualBasicSalary: 40000,
        annualDearnessAllowance: 4000,
        annualRetainingAllowance: 6000,
        annualCoreWages: 50000,
        annualTotalAllowances: 30000,
        annualExcessAllowance: 0,
        annualComplianceWageBase: 50000,
      },
    ],
    [
      'fixed monthly, annual, and core base',
      107500,
      rates,
      [
        allowance('A', 1000, {
          calculationType: 'fixed',
          fixedAmountPeriod: 'monthly',
        }),
        allowance('B', 3000, {
          calculationType: 'fixed',
          fixedAmountPeriod: 'annual',
        }),
        allowance('C', 10, { calculationBaseType: 'core_wages' }),
      ],
      {
        employerEpsContribution: 4000,
        employerEpfContribution: 2000,
        employerEsiContribution: 1500,
        annualGrossWages: 100000,
        annualBasicSalary: 40000,
        annualDearnessAllowance: 4000,
        annualRetainingAllowance: 6000,
        annualCoreWages: 50000,
        annualTotalAllowances: 20000,
        annualExcessAllowance: 0,
        annualComplianceWageBase: 50000,
      },
    ],
    [
      'fractional CTC',
      1075.01075,
      rates,
      [],
      {
        employerEpsContribution: 40,
        employerEpfContribution: 20,
        employerEsiContribution: 15,
        annualGrossWages: 1000.01,
        annualBasicSalary: 400,
        annualDearnessAllowance: 40,
        annualRetainingAllowance: 60,
        annualCoreWages: 500.01,
        annualTotalAllowances: 0,
        annualExcessAllowance: 0,
        annualComplianceWageBase: 500.01,
      },
    ],
  ] as const)(
    '%s satisfies every Excel cell',
    (_label, ctc, r, extras, expected) => {
      const components = [...core(), ...extras];
      const result = annualPayroll(ctc, components, r);
      expect(result.annual).toEqual({
        annualCtc: Math.round(ctc * 100) / 100,
        ...expected,
      });
      verify(result, r, components);
    },
  );
  it('rejects missing, invalid, duplicate and cyclic configurations', () => {
    for (const value of [null, NaN, Infinity, -1, 101])
      expect(() =>
        annualPayroll(
          100,
          [c('BASIC', value as number), ...core().slice(1)],
          rates,
        ),
      ).toThrow();
    expect(() =>
      annualPayroll(100, core(), null as unknown as EmployerRates),
    ).toThrow('Configure statutory');
    expect(() => annualPayroll(100, [...core(), core()[0]], rates)).toThrow(
      'Duplicate',
    );
    expect(() =>
      annualPayroll(
        100,
        [
          ...core(),
          allowance('A', 10, {
            calculationBaseType: 'salary_component',
            calculationBaseComponentId: 'B',
          }),
          allowance('B', 10, {
            calculationBaseType: 'salary_component',
            calculationBaseComponentId: 'A',
          }),
        ],
        rates,
      ),
    ).toThrow('Circular');
    expect(() =>
      annualPayroll(
        100,
        [
          ...core(),
          allowance('A', 10, {
            calculationBaseType: 'salary_component',
            calculationBaseComponentId: 'missing',
          }),
        ],
        rates,
      ),
    ).toThrow('missing or inactive');
    expect(() =>
      annualPayroll(
        100,
        [...core(), allowance('A', 10, { calculationType: 'fixed' })],
        rates,
      ),
    ).toThrow('period');
  });
  it('rejects an infeasible system rather than returning a partial numerical iterate', () => {
    expect(() =>
      annualPayroll(
        1,
        [
          ...core(),
          allowance('A', 1000, {
            calculationType: 'fixed',
            fixedAmountPeriod: 'annual',
          }),
        ],
        rates,
      ),
    ).toThrow('no unique valid solution');
  });
  it('solves a system that would diverge under naive fixed-point iteration', () => {
    const components = [
      ...core(),
      ...Array.from({ length: 8 }, (_, i) => allowance(`A${i}`, 100)),
    ];
    const result = annualPayroll(100000, components, {
      ...rates,
      esiEmployerContributionPercentage: 100,
    });
    verify(
      result,
      { ...rates, esiEmployerContributionPercentage: 100 },
      components,
    );
    expect(result.diagnostics.branch).toBe('positive');
  });
  it('does not treat other earnings, hidden flags, or deductions as allowance classification', () => {
    const components = [
      ...core(),
      c('OTHER', 90),
      c('DEDUCTION', 10, { category: 'deduction' }),
      allowance('HIDDEN', 10, { showInPayslip: false }),
    ];
    const result = annualPayroll(107500, components, rates);
    expect(result.annual.annualTotalAllowances).toBe(10000);
    verify(result, rates, components);
  });
});
