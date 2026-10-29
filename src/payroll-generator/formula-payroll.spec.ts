import { annualPayroll } from './annual-payroll';
import { CalculationComponent } from './salary-calculation.service';
const core = (): CalculationComponent[] =>
  ['BASIC', 'DA', 'RA'].map((code, i) => ({
    _id: code,
    code,
    category: 'earning',
    calculationBaseType: 'annual_ctc',
    calculationType: 'percentage',
    calculationValue: [40, 10, 15][i],
    showInPayslip: true,
    status: 'active',
  }));
const formula = (
  id: string,
  expression: string,
  category: 'earning' | 'deduction' | 'allowance' = 'earning',
): CalculationComponent => ({
  _id: id,
  code: id,
  category,
  calculationBaseType: 'annual_ctc',
  calculationType: 'formula',
  formula: expression,
  calculationValue: null,
  showInPayslip: true,
  status: 'active',
});
const rates = {
  epsEmployerContributionPercentage: 8,
  epfEmployerContributionPercentage: 4,
  esiEmployerContributionPercentage: 3,
};
describe('Formula components in the authoritative annual solver', () => {
  it('uses employee annual values, dependency resolution and annual-derived monthly amounts', () => {
    const a = '000000000000000000000001',
      b = '000000000000000000000002';
    for (const ctc of [107500, 215000]) {
      const result = annualPayroll(
        ctc,
        [
          formula(b, 'component_' + a + ' / 2 + 1200', 'deduction'),
          ...core(),
          formula(
            a,
            '(annualBasicSalary + annualDearnessAllowance + annualRetainingAllowance) * 0.10',
          ),
        ],
        rates,
      );
      const first = result.components.find((c) => c.componentId === a)!,
        second = result.components.find((c) => c.componentId === b)!;
      expect(first.annual).toBe(ctc === 107500 ? 5000 : 10000);
      expect(first.monthly).toBe(ctc === 107500 ? 416.67 : 833.33);
      expect(second.annual).toBe(ctc === 107500 ? 3700 : 6200);
      expect(result.annual.annualNetPay).toBe(
        result.annual.annualGrossWages - second.annual,
      );
      expect(result.diagnostics.equationResidual).toBe(0);
    }
  });
  it('integrates formula allowances identically to existing percentage allowances', () => {
    const c: CalculationComponent = {
      ...formula('EXISTING', '0', 'allowance'),
      calculationType: 'percentage',
      calculationValue: 70,
      calculationBaseType: 'gross_wages',
    };
    const previous = annualPayroll(108100, [...core(), c], rates);
    const current = annualPayroll(
      108100,
      [
        ...core(),
        { ...c, calculationType: 'formula', formula: 'annualGrossWages * 0.7' },
      ],
      rates,
    );
    expect(current.annual).toEqual(previous.annual);
    expect(current.components).toEqual(previous.components);
  });
  it('evaluates remaining variables and exact decimal constants', () => {
    const result = annualPayroll(
      107500,
      [
        ...core(),
        formula(
          'X',
          'annualCoreWages / 100 + annualCtc * .01 + annualGrossWages * .01 - 100',
        ),
      ],
      rates,
    );
    expect(result.components.at(-1)?.annual).toBe(2475);
  });
  it.each([
    '1 / (annualCtc - annualCtc)',
    '1 - annualCtc',
    'annualGrossWages * annualBasicSalary',
    'component_000000000000000000000001',
  ])('rejects invalid employee-specific results: %s', (expression) => {
    expect(() =>
      annualPayroll(107500, [...core(), formula('X', expression)], rates),
    ).toThrow();
  });
  it('detects formula cycles in saved records even if configuration validation is bypassed', () => {
    const a = '000000000000000000000001';
    expect(() =>
      annualPayroll(107500, [...core(), formula(a, 'component_' + a)], rates),
    ).toThrow('Circular');
  });
});
