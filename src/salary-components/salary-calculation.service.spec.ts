import {
  SalaryCalculationService,
  CalculationComponent,
} from './salary-calculation.service';

const component = (
  id: string,
  overrides: Partial<CalculationComponent> = {},
): CalculationComponent => ({
  _id: id,
  code: id,
  category: 'earning',
  calculationBaseType: 'annual_ctc',
  calculationType: 'percentage',
  calculationValue: 40,
  showInPayslip: true,
  status: 'active',
  ...overrides,
});
describe('Salary calculation foundation', () => {
  const engine = new SalaryCalculationService();
  it('resolves reversed dependencies and includes hidden deductions', () => {
    const result = engine.calculate(1200000, [
      component('HRA', {
        calculationBaseType: 'salary_component',
        calculationBaseComponentId: 'BASIC',
        category: 'deduction',
        showInPayslip: false,
      }),
      component('BASIC'),
    ]);
    expect(result.map((r) => [r.code, r.annual, r.monthly])).toEqual([
      ['BASIC', 480000, 40000],
      ['HRA', 192000, 16000],
    ]);
    expect(result[1].showInPayslip).toBe(false);
  });
  it('distinguishes fixed monthly and annual values', () => {
    expect(
      engine
        .calculate(0, [
          component('M', {
            calculationType: 'fixed',
            calculationValue: 2000,
            fixedAmountPeriod: 'monthly',
          }),
          component('A', {
            calculationType: 'fixed',
            calculationValue: 2000,
            fixedAmountPeriod: 'annual',
          }),
        ])
        .map((r) => [r.annual, r.monthly]),
    ).toEqual([
      [24000, 2000],
      [2000, 166.67],
    ]);
  });
  it('rejects cycles, missing and inactive dependencies', () => {
    expect(() =>
      engine.calculate(1, [
        component('A', {
          calculationBaseType: 'salary_component',
          calculationBaseComponentId: 'B',
        }),
        component('B', {
          calculationBaseType: 'salary_component',
          calculationBaseComponentId: 'A',
        }),
      ]),
    ).toThrow('Circular');
    for (const extra of [[], [component('B', { status: 'inactive' })]])
      expect(() =>
        engine.calculate(1, [
          component('A', {
            calculationBaseType: 'salary_component',
            calculationBaseComponentId: 'B',
          }),
          ...extra,
        ]),
      ).toThrow('missing or inactive');
  });
  it('rejects invalid numbers and percentages and skips inactive outputs', () => {
    for (const n of [NaN, Infinity, -1])
      expect(() => engine.calculate(n, [])).toThrow();
    expect(() =>
      engine.calculate(1, [component('A', { calculationValue: 101 })]),
    ).toThrow('Percentage');
    expect(
      engine.calculate(1, [component('A', { status: 'inactive' })]),
    ).toEqual([]);
  });
});
