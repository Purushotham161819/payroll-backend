import { BadRequestException } from '@nestjs/common';
import type { CalculationComponent } from './salary-calculation.service';
import { Ratio as R } from './decimal-ratio';

export interface EmployerRates {
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

export function annualPayroll(
  ctc: number,
  components: CalculationComponent[],
  settings: EmployerRates,
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
  const resolve = (id: string): Affine => {
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
  const candidates: { G: R; excess: R; branch: string }[] = [];
  for (const positive of [false, true]) {
    const denominator = one
      .add(w.mul(pe.add(pf).add(ps)))
      .add(positive ? ps.mul(A.slope.sub(half)) : zero);
    const numerator = C.sub(positive ? ps.mul(A.constant) : zero);
    if (denominator.n === 0n) {
      if (numerator.n === 0n)
        fail('Ambiguous payroll equations: singular solution system.');
      continue;
    }
    const G = numerator.div(denominator);
    const excess = A.slope.mul(G).add(A.constant).sub(half.mul(G));
    if (G.n >= 0n && (positive ? excess.n > 0n : excess.n <= 0n))
      candidates.push({
        G,
        excess: positive ? excess : zero,
        branch: positive ? 'positive' : 'zero',
      });
  }
  if (candidates.length !== 1)
    fail(
      'Payroll equations have no unique valid solution; cannot converge to a reliable payroll.',
    );
  const { G, excess: X, branch } = candidates[0];
  const B = G.mul(pb),
    D = B.mul(pd),
    RA = B.mul(pr),
    W = B.add(D).add(RA);
  const allowance = A.slope.mul(G).add(A.constant),
    Q = W.add(X);
  const EPS = W.mul(pe),
    EPF = W.mul(pf),
    ESI = Q.mul(ps);
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
    W.mul(pe),
    W.mul(pf),
    Q.mul(ps),
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
      return {
        componentId: c._id.toString(),
        code: c.code,
        category: c.category,
        annual: value.money(),
        monthly: value.div(R.of(12)).money(),
        showInPayslip: c.showInPayslip,
      };
    });
  return {
    annual: Object.fromEntries(
      Object.entries(cells).map(([k, v]) => [k, v.money()]),
    ),
    components: amounts,
    diagnostics: {
      branch,
      dependencyGraph: graph,
      equationResidual: 0,
      rounding:
        'Half up to paise at reporting only; equations verified exactly before rounding.',
    },
  };
}
