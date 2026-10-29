import { FORMULA_VARIABLE_BY_ID } from './formula-registry';
import { BadRequestException } from '@nestjs/common';
import { FormulaNode, formulaVariables, parseFormula } from './formula-parser';
import { evaluateFormula } from './formula-evaluator';
import { Ratio as R } from '../payroll-generator/decimal-ratio';
interface Node {
  _id: { toString(): string };
  code: string;
  status: string;
  calculationType: string;
  calculationBaseType: string;
  calculationBaseComponentId?: { toString(): string } | null;
  formula?: string | null;
}
// Validate mixed formula and existing calculation-base edges as one graph.
export function validateFormulaGraph(records: Node[], candidateId: string) {
  const graph = new Map(records.map((c) => [c._id.toString(), c]));
  const done = new Map<string, boolean>(),
    visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id))
      throw new Error(
        'Circular salary component dependencies are not allowed.',
      );
    if (visiting.size >= 128)
      throw new Error('Salary component dependency chain exceeds 128 levels.');
    if (done.has(id)) return done.get(id)!;
    const node = graph.get(id);
    if (!node) throw new Error('Calculation base does not exist.');
    visiting.add(id);
    const ref = (baseId: string) => {
      const base = graph.get(baseId);
      if (!base)
        throw new Error(
          'Formula component or calculation base does not exist.',
        );
      if (node.status === 'active' && base.status !== 'active')
        throw new Error(
          'Active components require active bases. Deactivate dependent components first.',
        );
      if (
        id === candidateId &&
        node.status === 'active' &&
        base.status !== 'active'
      )
        throw new Error(
          'An inactive component cannot be selected as a calculation base.',
        );
      return visit(baseId);
    };
    let dependent: boolean;
    if (node.calculationType === 'formula') {
      const parsed = parseFormula(node.formula);
      const shape = (
        ast: FormulaNode,
      ): { dependent: boolean; literal: R | null } => {
        if (ast.kind === 'number')
          return {
            dependent: false,
            literal: evaluateFormula(ast, () => {
              throw new Error('Missing variable');
            }).constant,
          };
        if (ast.kind === 'variable') {
          const metadata = FORMULA_VARIABLE_BY_ID.get(ast.name);
          if (metadata?.setting || ast.name === 'annualCtc')
            return { dependent: false, literal: null };
          if (ast.name === 'annualGrossWages' || ast.name === 'annualCoreWages')
            return { dependent: true, literal: null };
          if (metadata && !metadata.componentCode) {
            const dependencies = (key: string): boolean => {
              if (key === 'allowance_components')
                return records
                  .filter(
                    (c) =>
                      c.status === 'active' &&
                      (c as Node & { category?: string }).category ===
                        'allowance',
                  )
                  .map((c) => ref(c._id.toString()))
                  .some(Boolean);
              const v = FORMULA_VARIABLE_BY_ID.get(key);
              if (!v) return false;
              if (v.componentCode)
                return ref(
                  records
                    .find((c) => c.code === v.componentCode)
                    ?._id.toString() ?? '',
                );
              if (v.setting || key === 'annualCtc') return false;
              if (key === 'annualGrossWages' || key === 'annualCoreWages')
                return true;
              return v.dependencies.map(dependencies).some(Boolean);
            };
            return {
              dependent: metadata.dependencies.map(dependencies).some(Boolean),
              literal: null,
            };
          }
          const code = formulaVariables[ast.name];
          const baseId = ast.name.startsWith('component_')
            ? ast.name.slice(10)
            : records.find((c) => c.code === code)?._id.toString();
          return { dependent: ref(baseId ?? ''), literal: null };
        }
        if (ast.kind === 'if') {
          const condition = shape(ast.condition),
            then = shape(ast.then),
            otherwise = shape(ast.otherwise);
          return {
            dependent:
              condition.dependent || then.dependent || otherwise.dependent,
            literal: null,
          };
        }
        if (ast.kind === 'compare') {
          const a = shape(ast.left),
            b = shape(ast.right);
          return { dependent: a.dependent || b.dependent, literal: null };
        }
        if (ast.kind === 'call') {
          const args = ast.args.map(shape);
          return {
            dependent: args.some((arg) => arg.dependent),
            literal: args.every((arg) => arg.literal !== null)
              ? evaluateFormula(ast, () => {
                  throw new Error('Missing variable');
                }).constant
              : null,
          };
        }
        const a = shape(ast.left),
          b = shape(ast.right);
        if (ast.op === '*' && a.dependent && b.dependent)
          throw new Error(
            'Nonlinear formula: cannot multiply two wage-dependent values.',
          );
        if (ast.op === '/' && b.dependent)
          throw new Error(
            'Nonlinear formula: division by a wage-dependent value is unsupported.',
          );
        if (ast.op === '/' && b.literal?.n === 0n)
          throw new Error('Formula division by zero.');
        const literal =
          a.literal && b.literal
            ? evaluateFormula(ast, () => {
                throw new Error('Missing variable');
              }).constant
            : null;
        return { dependent: a.dependent || b.dependent, literal };
      };
      dependent = shape(parsed.root).dependent;
    } else {
      const base =
        node.calculationBaseType === 'salary_component'
          ? ref(node.calculationBaseComponentId?.toString() ?? '')
          : node.calculationBaseType !== 'annual_ctc';
      dependent =
        ['BASIC', 'DA', 'RA'].includes(node.code) ||
        (node.calculationType !== 'fixed' && base);
    }
    visiting.delete(id);
    done.set(id, dependent);
    return dependent;
  };
  try {
    for (const id of graph.keys()) visit(id);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid formula configuration.',
    );
  }
}
