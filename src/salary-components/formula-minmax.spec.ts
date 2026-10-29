import { parseFormula } from './formula-parser';
import { evaluateFormula } from './formula-evaluator';
import { Ratio as R } from '../payroll-generator/decimal-ratio';
const amount = (value: number) => ({ slope: R.of(0), constant: R.of(value) });
const value = (expression: string, vars: Record<string, number> = {}) =>
  evaluateFormula(parseFormula(expression).root, (name) => {
    if (!(name in vars)) throw new Error('Unavailable ' + name);
    return amount(vars[name]);
  }).constant.money();
describe('MIN/MAX, percentage literals and readable formula variables', () => {
  it('accepts the exact requested formula with stable canonical variables', () => {
    const expression = 'MIN(Annual Core Wages, Annual EPF Ceiling Limit) * 12%';
    expect(parseFormula(expression).variables).toEqual([
      'annualCoreWages',
      'annualEpfCeilingLimit',
    ]);
    expect(
      value(expression, {
        annualCoreWages: 50000,
        annualEpfCeilingLimit: 180000,
      }),
    ).toBe(6000);
    expect(
      value(expression, {
        annualCoreWages: 200000,
        annualEpfCeilingLimit: 180000,
      }),
    ).toBe(21600);
  });
  it('supports case-insensitive labels/internal keys, whitespace and all aliases', () => {
    expect(
      value('min( aNnUaL   cOrE WaGeS, ANNUALEPFCEILINGLIMIT ) * 12%', {
        annualCoreWages: 50000,
        annualEpfCeilingLimit: 180000,
      }),
    ).toBe(6000);
    expect(
      value(
        '(Annual Basic Salary + Annual Dearness Allowance + Annual Retaining Allowance + Annual Gross Wages + Annual CTC + Annual ESI Wage Ceiling Limit)*1%',
        {
          annualBasicSalary: 40,
          annualDearnessAllowance: 10,
          annualRetainingAllowance: 15,
          annualGrossWages: 100,
          annualCtc: 110,
          annualEsiCeilingLimit: 25,
        },
      ),
    ).toBe(3);
  });
  it('handles MIN/MAX, multiple arguments, nested calls, arithmetic and percentages', () => {
    expect(
      value('MAX(annualBasicSalary, 15000) * 10%', {
        annualBasicSalary: 40000,
      }),
    ).toBe(4000);
    expect(value('MIN(5, MAX(1, 3, 2), 4) + (100 * 12%) / 2 - .5')).toBe(8.5);
    expect(value('12%')).toBe(0.12);
    expect(
      value('(Annual Basic Salary + Annual Dearness Allowance) * 12%', {
        annualBasicSalary: 40000,
        annualDearnessAllowance: 4000,
      }),
    ).toBe(5280);
  });
  it.each([
    'MIN()',
    'MIN(1)',
    'MAX(1,2,3,4,5,6,7,8,9)',
    'MIN(1,)',
    'MIN(,1)',
    'MIN(1 2)',
    'SUM(1,2)',
    'Math.min(1,2)',
    'MIN(process.env.KEY,1)',
    'MIN(1/0,2)',
    '12%%',
    'MIN(Annual Missing Wages,1)',
  ])('rejects invalid calls or unsafe syntax: %s', (expression) => {
    expect(() => value(expression)).toThrow();
  });
  it('rejects unavailable values rather than returning zero', () => {
    expect(() =>
      value('MIN(Annual Core Wages,Annual EPF Ceiling Limit)', {
        annualCoreWages: 50000,
      }),
    ).toThrow('Unavailable annualEpfCeilingLimit');
  });
});
