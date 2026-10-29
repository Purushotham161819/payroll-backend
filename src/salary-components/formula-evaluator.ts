import { compareFormula } from './formula-registry';
import { Ratio as R } from '../payroll-generator/decimal-ratio';
import { FormulaNode } from './formula-parser';
export type FormulaAmount = { slope: R; constant: R };
export class FormulaBranchRequired extends Error {
  constructor(public readonly count: number) {
    super('MIN/MAX branch selection required.');
  }
}
export type FormulaConditionChoice = (
  operator: string,
  left: FormulaAmount,
  right: FormulaAmount,
) => boolean;
export type FormulaChoice = (
  name: 'MIN' | 'MAX',
  options: FormulaAmount[],
) => FormulaAmount;
// A*x+b expressions integrate directly with the existing exact annual solver.
export function evaluateFormula(
  node: FormulaNode,
  variable: (name: string) => FormulaAmount,
  choose?: FormulaChoice,
  conditionChoice?: FormulaConditionChoice,
): FormulaAmount {
  const result = evaluate(node, variable, choose, conditionChoice);
  for (const value of [result.slope, result.constant])
    if (value.n.toString(2).length > 4096 || value.d.toString(2).length > 4096)
      throw new Error('Formula exceeds the supported numeric complexity.');
  return result;
}
function evaluate(
  node: FormulaNode,
  variable: (name: string) => FormulaAmount,
  choose?: FormulaChoice,
  conditionChoice?: FormulaConditionChoice,
): FormulaAmount {
  if (node.kind === 'number') {
    const [whole, fraction = ''] = node.value.split('.');
    return {
      slope: R.of(0),
      constant: new R(
        BigInt((whole || '0') + fraction),
        10n ** BigInt(fraction.length),
      ),
    };
  }
  if (node.kind === 'variable') return variable(node.name);
  if (node.kind === 'compare')
    throw new Error('A comparison must be an IF condition.');
  if (node.kind === 'if') {
    if (node.condition.kind !== 'compare')
      throw new Error('IF requires a comparison condition.');
    const left = evaluateFormula(
        node.condition.left,
        variable,
        choose,
        conditionChoice,
      ),
      right = evaluateFormula(
        node.condition.right,
        variable,
        choose,
        conditionChoice,
      );
    const constant = left.slope.sub(right.slope).n === 0n;
    const selected = constant
      ? compareFormula(node.condition.op, left.constant.sub(right.constant).n)
      : conditionChoice
        ? conditionChoice(node.condition.op, left, right)
        : (() => {
            throw new FormulaBranchRequired(2);
          })();
    return evaluateFormula(
      selected ? node.then : node.otherwise,
      variable,
      choose,
      conditionChoice,
    );
  }
  if (node.kind === 'call') {
    const options = node.args.map((arg) =>
      evaluateFormula(arg, variable, choose, conditionChoice),
    );
    if (
      options.every((option) => option.slope.sub(options[0].slope).n === 0n)
    ) {
      return options.reduce((a, b) =>
        (
          node.name === 'MIN'
            ? a.constant.sub(b.constant).n <= 0n
            : a.constant.sub(b.constant).n >= 0n
        )
          ? a
          : b,
      );
    }
    if (!choose) throw new FormulaBranchRequired(options.length);
    return choose(node.name, options);
  }
  const a = evaluateFormula(node.left, variable, choose, conditionChoice),
    b = evaluateFormula(node.right, variable, choose, conditionChoice);
  if (node.op === '+')
    return {
      slope: a.slope.add(b.slope),
      constant: a.constant.add(b.constant),
    };
  if (node.op === '-')
    return {
      slope: a.slope.sub(b.slope),
      constant: a.constant.sub(b.constant),
    };
  if (node.op === '*') {
    if (a.slope.n && b.slope.n)
      throw new Error(
        'Nonlinear formula: cannot multiply two wage-dependent values.',
      );
    return {
      slope: a.slope.mul(b.constant).add(b.slope.mul(a.constant)),
      constant: a.constant.mul(b.constant),
    };
  }
  if (b.slope.n)
    throw new Error(
      'Nonlinear formula: division by a wage-dependent value is unsupported.',
    );
  if (!b.constant.n) throw new Error('Formula division by zero.');
  return {
    slope: a.slope.div(b.constant),
    constant: a.constant.div(b.constant),
  };
}
