import { parseFormula } from './formula-parser';
import { evaluateFormula } from './formula-evaluator';
import { Ratio as R } from '../payroll-generator/decimal-ratio';
const evaluate = (text: string) =>
  evaluateFormula(parseFormula(text).root, () => {
    throw new Error('Missing variable');
  }).constant.money();
describe('Safe IF conditions', () => {
  it.each([
    ['=', 2, 2, 10],
    ['!=', 2, 2, 0],
    ['<', 1, 2, 10],
    ['<=', 2, 2, 10],
    ['>', 3, 2, 10],
    ['>=', 2, 2, 10],
    ['=', 1, 2, 0],
    ['!=', 1, 2, 10],
  ])('supports comparison %s', (op, left, right, expected) => {
    expect(evaluate(`IF(${left} ${op} ${right},10,0)`)).toBe(expected);
  });
  it('supports nested conditions, parentheses, MIN/MAX and percentages with lazy evaluation', () => {
    expect(
      evaluate(
        'IF((1 + 2) <= MIN(3,4), IF(5 != 2, MAX(100,20) * 12%, 0), 1/0)',
      ),
    ).toBe(12);
    expect(evaluate('IF(1 > 2, 1/0, 7)')).toBe(7);
    expect(
      evaluateFormula(
        parseFormula('IF(1=1,2,annualEsiCeilingLimit)').root,
        () => {
          throw new Error('Missing variable');
        },
      ).constant.money(),
    ).toBe(2);
  });
  it.each([
    'IF()',
    'IF(,1,0)',
    'IF(1,1,0)',
    'IF(1=1,,0)',
    'IF(1=1,1,)',
    'IF(1=1,1)',
    'IF(1=1,1,0,2)',
    'IF(1==1,1,0)',
    'IF(1<>1,1,0)',
    'IF(1<2<3,1,0)',
    '1<=2',
    '1+IF(1=1,2<3,0)',
    'IF(process.env.KEY=1,1,0)',
    'IF(1=1,unknown,0)',
  ])('rejects invalid conditional syntax: %s', (text) => {
    expect(() => parseFormula(text)).toThrow();
  });
  it('requires a numeric result in every branch and numeric MIN/MAX arguments', () => {
    expect(() => parseFormula('MIN(1<2,3)')).toThrow('comparison');
    expect(() => parseFormula('IF(1=1,1,2=3)')).toThrow('comparison');
  });
});
