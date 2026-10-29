import { parseFormula } from './formula-parser';
import { evaluateFormula } from './formula-evaluator';
import { Ratio as R } from '../payroll-generator/decimal-ratio';
const constant = (value: number) => ({ slope: R.of(0), constant: R.of(value) });
describe('Safe formula grammar and exact evaluation', () => {
  it('uses precedence, parentheses, decimals and unary signs without executable code', () => {
    const parsed = parseFormula('-(1.25 - .25) + (annualCtc / 100) * 2');
    expect(parsed.variables).toEqual(['annualCtc']);
    expect(
      evaluateFormula(parsed.root, () => constant(1000)).constant.money(),
    ).toBe(19);
  });
  it.each([
    '',
    '1 +',
    '(1+2',
    'Math.max(1,2)',
    'annualCtc.constructor',
    'process.env.KEY',
    'require("fs")',
    'globalThis',
    '1; 2',
    '1 ** 2',
    '1e3',
    '__proto__',
    'annualNetPay',
    'a'.repeat(1025),
    '('.repeat(49) + '1' + ')'.repeat(49),
  ])('rejects invalid or unsafe input %p', (formula) => {
    expect(() => parseFormula(formula)).toThrow();
  });
  it('rejects zero denominators, nonlinear wage terms and missing values', () => {
    expect(() =>
      evaluateFormula(parseFormula('1/(2-2)').root, () => constant(1)),
    ).toThrow('zero');
    const wage = () => ({ slope: R.of(1), constant: R.of(0) });
    expect(() =>
      evaluateFormula(
        parseFormula('annualGrossWages * annualBasicSalary').root,
        wage,
      ),
    ).toThrow('Nonlinear');
    expect(() =>
      evaluateFormula(parseFormula('annualCtc / annualGrossWages').root, wage),
    ).toThrow('Nonlinear');
    expect(() =>
      evaluateFormula(parseFormula('annualCtc').root, () => {
        throw new Error('Missing variable');
      }),
    ).toThrow('Missing');
  });
  it('bounds arithmetic size to prevent uncontrolled big-integer growth', () => {
    expect(() =>
      evaluateFormula(parseFormula('annualCtc * annualCtc').root, () => ({
        slope: R.of(0),
        constant: new R(1n << 4090n),
      })),
    ).toThrow('complexity');
  });
});
