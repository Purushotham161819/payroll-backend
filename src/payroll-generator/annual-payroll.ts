import { validateFormulaGraph } from '../salary-components/formula-graph';
import {
  FORMULA_VARIABLE_BY_ID,
  compareFormula,
} from '../salary-components/formula-registry';
import { BadRequestException } from '@nestjs/common';
import type { CalculationComponent } from './salary-calculation.service';
import {
  parseFormula,
  formulaVariables,
} from '../salary-components/formula-parser';
import {
  evaluateFormula,
  FormulaBranchRequired,
  FormulaAmount,
} from '../salary-components/formula-evaluator';
import { Ratio as R } from './decimal-ratio';

export interface EmployerRates {
  isEpfCeilingApplicable?: boolean;
  epfEmployeeContributionPercentage?: number;
  esiEmployeeContributionPercentage?: number;
  wageCap?: number;
  annualEsiCeilingLimit?: number;
  epsEmployerContributionPercentage: number;
  epfEmployerContributionPercentage: number;
  esiEmployerContributionPercentage: number;
}
const zero = R.of(0),
  one = R.of(1),
  half = R.of(0.5);
type Affine = { slope: R; constant: R };
const scale = (a: Affine, p: R): Affine => ({
  slope: a.slope.mul(p),
  constant: a.constant.mul(p),
});
const sum = (a: Affine, b: Affine): Affine => ({
  slope: a.slope.add(b.slope),
  constant: a.constant.add(b.constant),
});

class InvalidFormulaBranch extends Error {}
export function annualPayroll(
  ctc: number,
  components: CalculationComponent[],
  settings: EmployerRates,
) {
  if (
    components.some(
      (c) => c.status === 'active' && c.calculationType === 'formula',
    )
  )
    validateFormulaGraph(
      components.filter((c) => c.status === 'active'),
      '',
    );
  const pending: number[][] = [[]];
  const answers: ReturnType<typeof annualPayrollBranch>[] = [];
  let attempts = 0;
  while (pending.length) {
    if (++attempts > 256)
      throw new BadRequestException(
        'Conditional/MIN/MAX formulas exceed the supported 256 branch evaluations. Simplify the formulas.',
      );
    const choices = pending.pop()!;
    try {
      const result = annualPayrollBranch(ctc, components, settings, choices);
      answers.push(result);
    } catch (error) {
      if (error instanceof FormulaBranchRequired) {
        for (let i = error.count - 1; i >= 0; i--)
          pending.push([...choices, i]);
      } else if (!(error instanceof InvalidFormulaBranch)) throw error;
    }
  }
  const eligible = answers.filter(
    (result) => result.diagnostics.employerEsiEligible,
  );
  const preferred = eligible.length ? eligible : answers;
  if (preferred.length !== 1)
    throw new BadRequestException(
      'Payroll equations have ' +
        (preferred.length ? 'multiple' : 'no') +
        ' valid solutions after employer ESI eligibility preference.',
    );
  return preferred[0];
}
function annualPayrollBranch(
  ctc: number,
  components: CalculationComponent[],
  settings: EmployerRates,
  choices: number[],
) {
  const fail = (message: string): never => {
    throw new BadRequestException(message);
  };
  const decimal = (
    v: number | null | undefined,
    label: string,
    percentage = false,
  ): R => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < 0 ||
      (percentage && v > 100)
    )
      return fail(`Invalid or missing ${label}.`);
    return percentage ? R.of(v).div(R.of(100)) : R.of(v);
  };
  const C = decimal(ctc, 'Annual CTC');
  C.money();
  if (!settings)
    fail('Configure statutory deductions before calculating payroll.');
  const pe = decimal(
    settings?.epsEmployerContributionPercentage,
    'EPS employer percentage',
    true,
  );
  const pf = decimal(
    settings?.epfEmployerContributionPercentage,
    'EPF employer percentage',
    true,
  );
  const ps = decimal(
    settings?.esiEmployerContributionPercentage,
    'ESI employer percentage',
    true,
  );
  if (
    settings.isEpfCeilingApplicable !== undefined &&
    typeof settings.isEpfCeilingApplicable !== 'boolean'
  )
    fail('Invalid EPF ceiling applicability.');
  const epfCap = settings.isEpfCeilingApplicable
    ? decimal(settings.wageCap, 'Annual EPF Ceiling Limit')
    : null;
  const esiCeiling =
    settings.annualEsiCeilingLimit === undefined
      ? null
      : decimal(
          settings.annualEsiCeilingLimit,
          'Annual ESI Wage Ceiling Limit',
        );
  const records = new Map<string, CalculationComponent>(),
    codes = new Set<string>();
  for (const c of components) {
    const id = c._id?.toString();
    if (!id || !c.code || records.has(id) || codes.has(c.code))
      fail('Duplicate or missing salary component identity.');
    if (
      !['active', 'inactive'].includes(c.status) ||
      !['earning', 'deduction', 'allowance'].includes(c.category)
    )
      fail(`Invalid configuration for ${c.code}.`);
    records.set(id, c);
    codes.add(c.code);
  }
  const mandatory = (code: string) => {
    const c = components.find((c) => c.code === code);
    if (
      !c ||
      c.status !== 'active' ||
      c.category !== 'earning' ||
      c.calculationType !== 'percentage'
    )
      return fail(
        `Mandatory component ${code} requires an active earning percentage.`,
      );
    return decimal(c.calculationValue, `${code} percentage`, true);
  };
  const pb = mandatory('BASIC'),
    pd = mandatory('DA'),
    pr = mandatory('RA');
  const w = pb.mul(one.add(pd).add(pr));
  const resolved = new Map<string, Affine>(),
    visiting = new Set<string>();
  const graph: Record<string, string[]> = {};
  const constraints: {
    name: 'MIN' | 'MAX';
    options: FormulaAmount[];
    selected: number;
  }[] = [];
  let choiceIndex = 0;
  const choose = (name: 'MIN' | 'MAX', options: FormulaAmount[]) => {
    const selected = choices[choiceIndex++];
    if (selected === undefined) throw new FormulaBranchRequired(options.length);
    constraints.push({ name, options, selected });
    return options[selected];
  };
  const conditions: {
    op: string;
    left: Affine;
    right: Affine;
    selected: boolean;
  }[] = [];
  const chooseCondition = (op: string, left: Affine, right: Affine) => {
    const index = choices[choiceIndex++];
    if (index === undefined) throw new FormulaBranchRequired(2);
    const selected = index === 0;
    conditions.push({ op, left, right, selected });
    return selected;
  };
  const aggregateCache = new Map<string, Affine>();
  const variable = (name: string): Affine => {
    const cached = aggregateCache.get(name);
    if (cached) return cached;
    const metadata = FORMULA_VARIABLE_BY_ID.get(name);
    if (metadata?.setting)
      return {
        slope: zero,
        constant: decimal(
          settings[metadata.setting as keyof EmployerRates] as
            number | undefined,
          name,
          metadata.valueType === 'rate',
        ),
      };
    if (name === 'annualCtc') return { slope: zero, constant: C };
    if (name === 'annualGrossWages') return { slope: one, constant: zero };
    if (name === 'annualCoreWages') return { slope: w, constant: zero };
    if (name === 'annualTotalAllowances') {
      let total: Affine = { slope: zero, constant: zero };
      for (const c of components.filter(
        (c) => c.status === 'active' && c.category === 'allowance',
      ))
        total = sum(total, resolve(c._id.toString()));
      aggregateCache.set(name, total);
      return total;
    }
    if (name === 'annualExcessAllowance') {
      const a = variable('annualTotalAllowances');
      const excess = { slope: a.slope.sub(half), constant: a.constant };
      const value = choose('MAX', [excess, { slope: zero, constant: zero }]);
      aggregateCache.set(name, value);
      return value;
    }
    if (name === 'annualComplianceWageBase') {
      const value = sum(
        variable('annualCoreWages'),
        variable('annualExcessAllowance'),
      );
      aggregateCache.set(name, value);
      return value;
    }
    if (
      name === 'employerEpfContribution' ||
      name === 'employerEpsContribution'
    ) {
      const core = variable('annualCoreWages');
      const base = epfCap
        ? choose('MIN', [core, { slope: zero, constant: epfCap }])
        : core;
      const value = scale(base, name === 'employerEpfContribution' ? pf : pe);
      aggregateCache.set(name, value);
      return value;
    }
    if (name === 'employerEsiContribution') {
      const q = variable('annualComplianceWageBase');
      const eligible =
        !esiCeiling ||
        (q.slope.n === 0n
          ? compareFormula('<=', q.constant.sub(esiCeiling).n)
          : chooseCondition('<=', q, { slope: zero, constant: esiCeiling }));
      const value = eligible ? scale(q, ps) : { slope: zero, constant: zero };
      aggregateCache.set(name, value);
      return value;
    }
    const code = formulaVariables[name];
    const reference = name.startsWith('component_')
      ? name.slice(10)
      : components.find((c) => c.code === code)?._id.toString();
    return resolve(reference ?? '');
  };
  const resolve = (id: string): Affine => {
    if (visiting.size >= 128)
      return fail('Salary component dependency chain exceeds 128 levels.');
    if (visiting.has(id)) return fail('Circular salary component dependency.');
    const cached = resolved.get(id);
    if (cached) return cached;
    const c = records.get(id);
    if (!c || c.status !== 'active')
      return fail('Calculation base is missing or inactive.');
    visiting.add(id);
    let value: Affine;
    if (['BASIC', 'DA', 'RA'].includes(c.code)) {
      // Excel defines these bases regardless of legacy CTC-based metadata.
      const slope = c.code === 'BASIC' ? pb : pb.mul(c.code === 'DA' ? pd : pr);
      value = { slope, constant: zero };
      graph[id] = [c.code === 'BASIC' ? 'gross_wages' : 'BASIC'];
    } else if (c.calculationType === 'formula') {
      try {
        const parsed = parseFormula(c.formula);
        graph[id] = parsed.variables;
        value = evaluateFormula(parsed.root, variable, choose, chooseCondition);
      } catch (error) {
        if (error instanceof FormulaBranchRequired) throw error;
        return fail(
          'Formula ' +
            c.code +
            ': ' +
            (error instanceof Error ? error.message : 'Invalid formula.'),
        );
      }
    } else {
      const p = decimal(
        c.calculationValue,
        `${c.code} calculation value`,
        c.calculationType === 'percentage',
      );
      let base: Affine;
      graph[id] = [
        c.calculationBaseType === 'salary_component'
          ? (c.calculationBaseComponentId?.toString() ?? '')
          : c.calculationBaseType,
      ];
      switch (c.calculationBaseType) {
        case 'annual_ctc':
          base = { slope: zero, constant: C };
          break;
        case 'gross_wages':
          base = { slope: one, constant: zero };
          break;
        case 'core_wages':
          base = { slope: w, constant: zero };
          break;
        case 'salary_component':
          base = resolve(c.calculationBaseComponentId?.toString() ?? '');
          break;
        default:
          return fail(`Invalid calculation base for ${c.code}.`);
      }
      if (c.calculationType === 'percentage') value = scale(base, p);
      else if (
        c.calculationType === 'fixed' &&
        ['annual', 'monthly'].includes(c.fixedAmountPeriod ?? '')
      )
        value = {
          slope: zero,
          constant: p.mul(R.of(c.fixedAmountPeriod === 'monthly' ? 12 : 1)),
        };
      else
        return fail(
          `Invalid calculation type or fixed amount period for ${c.code}.`,
        );
    }
    visiting.delete(id);
    resolved.set(id, value);
    return value;
  };
  // Resolve and validate the full graph before solving either branch.
  let A: Affine = { slope: zero, constant: zero };
  for (const c of components.filter((c) => c.status === 'active')) {
    const v = resolve(c._id.toString());
    if (c.category === 'allowance') A = sum(A, v);
  }
  const candidates: {
    G: R;
    excess: R;
    branch: string;
    esiEligible: boolean;
  }[] = [];
  for (const capped of epfCap ? [false, true] : [false]) {
    for (const esiEligible of esiCeiling ? [true, false] : [true]) {
      for (const positive of [false, true]) {
        const esiRate = esiEligible ? ps : zero;
        const denominator = one
          .add(capped ? zero : w.mul(pe.add(pf)))
          .add(w.mul(esiRate))
          .add(positive ? esiRate.mul(A.slope.sub(half)) : zero);
        const numerator = C.sub(capped ? epfCap!.mul(pe.add(pf)) : zero).sub(
          positive ? esiRate.mul(A.constant) : zero,
        );
        if (denominator.n === 0n) {
          if (numerator.n === 0n)
            fail('Ambiguous payroll equations: singular solution system.');
          continue;
        }
        const G = numerator.div(denominator);
        const excess = A.slope.mul(G).add(A.constant).sub(half.mul(G));
        const consistent = constraints.every(({ name, options, selected }) => {
          const chosen = options[selected].slope
            .mul(G)
            .add(options[selected].constant);
          return options.every((option, index) => {
            const difference = chosen.sub(
              option.slope.mul(G).add(option.constant),
            );
            return (
              (name === 'MIN' ? difference.n <= 0n : difference.n >= 0n) &&
              !(difference.n === 0n && index < selected)
            );
          });
        });
        const conditionsConsistent = conditions.every(
          ({ op, left, right, selected }) =>
            compareFormula(
              op,
              left.slope
                .mul(G)
                .add(left.constant)
                .sub(right.slope.mul(G).add(right.constant)).n,
            ) === selected,
        );
        const core = w.mul(G),
          compliance = core.add(positive ? excess : zero);
        const capConsistent =
          !epfCap ||
          (capped ? core.sub(epfCap).n > 0n : core.sub(epfCap).n <= 0n);
        const eligibilityConsistent =
          !esiCeiling ||
          (esiEligible
            ? compliance.sub(esiCeiling).n <= 0n
            : compliance.sub(esiCeiling).n > 0n);
        if (
          consistent &&
          conditionsConsistent &&
          capConsistent &&
          eligibilityConsistent &&
          G.n >= 0n &&
          (positive ? excess.n > 0n : excess.n <= 0n)
        )
          candidates.push({
            G,
            excess: positive ? excess : zero,
            branch: positive ? 'positive' : 'zero',
            esiEligible,
          });
      }
    }
  }
  if (candidates.length === 0 && (constraints.length || conditions.length))
    throw new InvalidFormulaBranch();
  // Prefer the eligible result when both eligibility branches are self-consistent.
  const eligibleCandidates = candidates.filter(
    (candidate) => candidate.esiEligible,
  );
  if (eligibleCandidates.length)
    candidates.splice(0, candidates.length, ...eligibleCandidates);
  if (candidates.length !== 1)
    fail(
      'Payroll equations have no unique valid solution; cannot converge to a reliable payroll.',
    );
  const { G, excess: X, branch, esiEligible } = candidates[0];
  const B = G.mul(pb),
    D = B.mul(pd),
    RA = B.mul(pr),
    W = B.add(D).add(RA);
  const allowance = A.slope.mul(G).add(A.constant),
    Q = W.add(X);
  const epfBase = epfCap && W.sub(epfCap).n > 0n ? epfCap : W;
  const EPS = epfBase.mul(pe),
    EPF = epfBase.mul(pf),
    ESI = esiEligible ? Q.mul(ps) : zero;
  const cells = {
    annualCtc: C,
    employerEpsContribution: EPS,
    employerEpfContribution: EPF,
    employerEsiContribution: ESI,
    annualGrossWages: G,
    annualBasicSalary: B,
    annualDearnessAllowance: D,
    annualRetainingAllowance: RA,
    annualCoreWages: W,
    annualTotalAllowances: allowance,
    annualExcessAllowance: X,
    annualComplianceWageBase: Q,
  };
  const expected = [
    C,
    epfBase.mul(pe),
    epfBase.mul(pf),
    esiEligible ? Q.mul(ps) : zero,
    C.sub(EPS).sub(EPF).sub(ESI),
    G.mul(pb),
    B.mul(pd),
    B.mul(pr),
    B.add(D).add(RA),
    allowance,
    allowance.sub(G.mul(half)).n > 0n ? allowance.sub(G.mul(half)) : zero,
    W.add(X),
  ];
  Object.values(cells).forEach((v, i) => {
    if (v.sub(expected[i]).n !== 0n || v.n < 0n)
      fail('Payroll equation verification failed.');
  });
  const amounts = components
    .filter((c) => c.status === 'active')
    .map((c) => {
      const a = resolved.get(c._id.toString())!;
      const value = a.slope.mul(G).add(a.constant);
      if (value.n < 0n)
        fail(
          'Formula or component ' +
            c.code +
            ' produced a negative annual amount.',
        );
      return {
        componentId: c._id.toString(),
        code: c.code,
        category: c.category,
        annual: value.money(),
        monthly: value.div(R.of(12)).money(),
        showInPayslip: c.showInPayslip,
      };
    });
  // Reuse reported annual deduction cells exactly once, independent of report visibility.
  const totalDeductions = amounts
    .filter((c) => c.category === 'deduction')
    .reduce((total, c) => total.add(R.of(c.annual)), zero);
  const netPay = R.of(G.money()).sub(totalDeductions);
  return {
    annual: {
      ...Object.fromEntries(
        Object.entries(cells).map(([k, v]) => [k, v.money()]),
      ),
      annualTotalDeductions: totalDeductions.money(),
      annualNetPay: netPay.money(),
    },
    components: amounts,
    diagnostics: {
      employerEsiEligible: esiEligible,
      epfCeilingApplied: settings.isEpfCeilingApplicable ?? false,
      branch,
      dependencyGraph: graph,
      equationResidual: 0,
      rounding:
        'Half up to paise at reporting only; equations verified exactly before rounding.',
    },
  };
}
