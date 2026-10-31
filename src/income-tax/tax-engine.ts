import { BadRequestException } from '@nestjs/common';
import { Ratio as R } from '../payroll-generator/decimal-ratio';
import type { AnnualSalaryInput, TaxRules } from './tax.types';

const zero = R.of(0);
const min = (a: R, b: R) => (a.sub(b).n < 0n ? a : b);
const positive = (a: R) => (a.n < 0n ? zero : a);
function fail(message: string): never {
  throw new BadRequestException(message);
}
export function amount(
  value: unknown,
  label = 'Amount',
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12
  )
    fail(`${label} must be a finite non-negative amount up to 1 trillion.`);
}
function rate(value: unknown) {
  amount(value, 'Rate');
  if (value > 100) fail('Rate must be between zero and 100.');
}
export function validateRules(rules: TaxRules) {
  if (!rules || rules.ruleVersion !== 'salary-only-v1')
    fail('Unsupported tax rule version.');
  for (const [value, label] of [
    [rules.standardDeduction, 'Standard deduction'],
    [rules.rebateLimit, 'Rebate eligibility limit'],
    [rules.maximumRebate, 'Maximum rebate'],
  ] as const)
    amount(value, label);
  rate(rules.cessPercentage);
  if (
    typeof rules.rebateMarginalRelief !== 'boolean' ||
    typeof rules.surchargeMarginalRelief !== 'boolean'
  )
    fail('Marginal relief flags are required.');
  for (const v of [rules.incomeRounding, rules.liabilityRounding])
    if (!['paise', 'nearest-ten-ignore-paise'].includes(v))
      fail('Select an explicit rounding rule.');
  if (
    !Number.isInteger(rules.minimumAge) ||
    rules.minimumAge < 0 ||
    rules.minimumAge > 120 ||
    (rules.maximumAge !== null &&
      (!Number.isInteger(rules.maximumAge) ||
        rules.maximumAge < rules.minimumAge ||
        rules.maximumAge > 120))
  )
    fail('Invalid age eligibility.');
  if (
    !Array.isArray(rules.slabs) ||
    !rules.slabs.length ||
    rules.slabs.length > 50
  )
    fail('Supply complete tax slabs.');
  if (rules.slabs.some((s) => !s || typeof s !== 'object'))
    fail('Invalid slab.');
  const slabs = [...rules.slabs].sort((a, b) => a.from - b.from);
  let end: number | null = 0;
  slabs.forEach((s, i) => {
    if (!s || typeof s !== 'object') fail('Invalid slab.');
    amount(s.from);
    rate(s.rate);
    if (end === null || s.from !== end)
      fail('Slabs must start at zero without gaps or overlaps.');
    if (s.to !== null) {
      amount(s.to);
      if (s.to <= s.from) fail('Slab upper limit must exceed lower limit.');
    }
    if ((i === slabs.length - 1) !== (s.to === null))
      fail('Only the last slab must be unlimited.');
    end = s.to;
  });
  if (!Array.isArray(rules.surcharge) || rules.surcharge.length > 20)
    fail('Invalid surcharge tiers.');
  let previous = -1,
    previousRate = 0;
  for (const tier of rules.surcharge) {
    if (!tier || typeof tier !== 'object') fail('Invalid surcharge tier.');
    amount(tier.threshold);
    rate(tier.rate);
    if (tier.threshold <= previous || tier.rate < previousRate)
      fail('Surcharge thresholds and rates must increase.');
    previous = tier.threshold;
    previousRate = tier.rate;
  }
  if (!Array.isArray(rules.mappings) || rules.mappings.length > 500)
    fail('Supply component taxability mappings.');
  const ids = new Set<string>();
  for (const m of rules.mappings) {
    if (!m || typeof m !== 'object') fail('Invalid taxability mapping.');
    if (
      typeof m.componentId !== 'string' ||
      !m.componentId ||
      ids.has(m.componentId)
    )
      fail('Component taxability mappings must be unique.');
    ids.add(m.componentId);
    if (
      !['taxable', 'exempt', 'partial', 'conditional'].includes(m.type) ||
      typeof m.legalReference !== 'string' ||
      !m.legalReference.trim()
    )
      fail('Each mapping needs a treatment and legal reference.');
    if (m.type === 'partial') {
      if (
        (m.taxablePercentage === undefined) ===
        (m.exemptAmount === undefined)
      )
        fail(
          'Partial mapping needs either a taxable percentage or exempt amount.',
        );
      if (m.taxablePercentage !== undefined) rate(m.taxablePercentage);
      if (m.exemptAmount !== undefined) amount(m.exemptAmount);
    }
    if (
      m.type !== 'taxable' &&
      (typeof m.conditions !== 'string' || !m.conditions.trim())
    )
      fail('Exemptions require documented conditions.');
  }
  if (rules.employerContributionsReviewed !== true)
    fail('Employer contribution review confirmation is required.');
  if (typeof rules.reviewNote !== 'string' || !rules.reviewNote.trim())
    fail('Review note is required.');
  if (
    !Array.isArray(rules.legalReferences) ||
    !rules.legalReferences.length ||
    rules.legalReferences.some(
      (s) =>
        typeof s !== 'string' ||
        !/^https:\/\/([a-z0-9-]+\.)*(incometax\.gov\.in|incometaxindia\.gov\.in|egazette\.gov\.in|indiabudget\.gov\.in)\//i.test(
          s,
        ),
    )
  )
    fail(
      'Enter approved HTTPS official source URLs from the Income Tax, Gazette or Union Budget websites.',
    );
  return { ...rules, slabs };
}

// Statutory rounding first discards paise, then rounds whole rupees to tens.
function rounded(value: R, mode: TaxRules['incomeRounding']) {
  return mode === 'paise'
    ? R.of(value.money())
    : new R(((value.n / value.d + 5n) / 10n) * 10n);
}
function slabTax(income: R, rules: TaxRules) {
  let tax = zero;
  const breakdown = rules.slabs.map((s) => {
    const width = positive(
      min(income, s.to === null ? income : R.of(s.to)).sub(R.of(s.from)),
    );
    const liability = width.mul(R.of(s.rate)).div(R.of(100));
    tax = tax.add(liability);
    return { ...s, taxableAmount: width.money(), tax: liability.money() };
  });
  return { tax, breakdown };
}
function afterRebate(income: R, rules: TaxRules) {
  const { tax } = slabTax(income, rules);
  const rebate =
    income.sub(R.of(rules.rebateLimit)).n <= 0n
      ? min(tax, R.of(rules.maximumRebate))
      : zero;
  const relief =
    rules.rebateMarginalRelief && income.sub(R.of(rules.rebateLimit)).n > 0n
      ? positive(tax.sub(income.sub(R.of(rules.rebateLimit))))
      : zero;
  return { tax, rebate, relief, after: positive(tax.sub(rebate).sub(relief)) };
}
export function calculateAnnualTax(
  salary: AnnualSalaryInput,
  rawRules: TaxRules,
) {
  const rules = validateRules(rawRules);
  amount(salary.annual.annualCtc);
  amount(salary.annual.annualGrossWages);
  // Gross already includes earnings/allowances. Subtract only explicit exemptions;
  // never sum BASIC/DA/RA and accidentally double-count overlapping wage bases.
  let exemptions = zero;
  const taxableComponents = salary.components
    .filter((c) => c.category !== 'deduction')
    .map((c) => {
      amount(c.annual);
      const m = rules.mappings.find((m) => m.componentId === c.componentId);
      if (!m) fail(`Taxability mapping missing for ${c.code}.`);
      if (m.type === 'conditional')
        fail(
          `Conditional exemption for ${c.code} requires a future claims workflow.`,
        );
      const exempt =
        m.type === 'exempt'
          ? R.of(c.annual)
          : m.type === 'partial'
            ? m.exemptAmount !== undefined
              ? min(R.of(c.annual), R.of(m.exemptAmount))
              : R.of(c.annual)
                  .mul(R.of(100).sub(R.of(m.taxablePercentage!)))
                  .div(R.of(100))
            : zero;
      exemptions = exemptions.add(exempt);
      return {
        ...c,
        treatment: m.type,
        exempt: exempt.money(),
        taxable: R.of(c.annual).sub(exempt).money(),
        legalReference: m.legalReference,
      };
    });
  const gross = R.of(salary.annual.annualGrossWages);
  if (exemptions.sub(gross).n > 0n)
    fail(
      'Exemptions exceed existing Gross Wages; review overlapping components.',
    );
  const taxableSalary = gross.sub(exemptions);
  const standard = min(taxableSalary, R.of(rules.standardDeduction));
  const income = rounded(
    positive(taxableSalary.sub(standard)),
    rules.incomeRounding,
  );
  const base = afterRebate(income, rules);
  const tier = [...rules.surcharge]
    .reverse()
    .find((t) => income.sub(R.of(t.threshold)).n > 0n);
  const surcharge = tier
    ? base.after.mul(R.of(tier.rate)).div(R.of(100))
    : zero;
  let surchargeRelief = zero;
  if (tier && rules.surchargeMarginalRelief) {
    const boundary = R.of(tier.threshold);
    const previous = [...rules.surcharge]
      .reverse()
      .find((t) => t.threshold < tier.threshold);
    const boundaryTax = afterRebate(boundary, rules)
      .after.mul(R.of(100 + (previous?.rate ?? 0)))
      .div(R.of(100));
    surchargeRelief = positive(
      base.after.add(surcharge).sub(boundaryTax.add(income.sub(boundary))),
    );
  }
  const beforeCess = positive(base.after.add(surcharge).sub(surchargeRelief));
  const cess = beforeCess.mul(R.of(rules.cessPercentage)).div(R.of(100));
  const annualTds = rounded(
    beforeCess.add(cess),
    rules.liabilityRounding,
  ).money();
  const allocation = allocateMonthly(annualTds);
  return {
    annualCtc: salary.annual.annualCtc,
    annualGrossWages: gross.money(),
    taxableComponents,
    residualTaxableGross: gross
      .sub(
        salary.components
          .filter((c) => c.category !== 'deduction')
          .reduce((s, c) => s.add(R.of(c.annual)), zero),
      )
      .money(),
    exemptions: exemptions.money(),
    totalTaxableSalary: taxableSalary.money(),
    standardDeduction: standard.money(),
    otherAdjustments: 0,
    taxableIncome: income.money(),
    slabs: slabTax(income, rules).breakdown,
    taxBeforeRebate: base.tax.money(),
    rebate: base.rebate.money(),
    rebateMarginalRelief: base.relief.money(),
    surcharge: surcharge.money(),
    surchargeMarginalRelief: surchargeRelief.money(),
    marginalRelief: base.relief.add(surchargeRelief).money(),
    cess: cess.money(),
    annualEstimatedTax: annualTds,
    annualTds,
    monthlyTds: allocation[0],
    allocation,
    allocationRule:
      '12 monthly checks; floor to paise for first 11, residual in final check',
  };
}
export function allocateMonthly(annualTds: number, frequency = 'Monthly') {
  amount(annualTds);
  if (frequency !== 'Monthly')
    fail('Only monthly allocation is supported in Version 1.0.');
  const value = R.of(annualTds).mul(R.of(100));
  if (value.n % value.d !== 0n)
    fail('Annual TDS must have at most two decimal places.');
  const cents = value.n / value.d,
    regular = cents / 12n;
  return Array.from(
    { length: 12 },
    (_, i) => Number(i === 11 ? cents - regular * 11n : regular) / 100,
  );
}
