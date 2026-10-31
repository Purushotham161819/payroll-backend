import { validateRules, calculateAnnualTax } from '../income-tax/tax-engine';
import type { TaxRules } from '../income-tax/tax.types';
// These are validation fixtures. They are never installed in an organization.
export const validationFixture = (): TaxRules => ({
  ruleVersion: 'salary-only-v1',
  standardDeduction: 75000,
  rebateLimit: 1200000,
  maximumRebate: 60000,
  rebateMarginalRelief: true,
  cessPercentage: 4,
  surcharge: [
    { threshold: 5000000, rate: 10 },
    { threshold: 10000000, rate: 15 },
    { threshold: 20000000, rate: 25 },
  ],
  surchargeMarginalRelief: true,
  incomeRounding: 'nearest-ten-ignore-paise',
  liabilityRounding: 'nearest-ten-ignore-paise',
  minimumAge: 0,
  maximumAge: null,
  slabs: [0, 400000, 800000, 1200000, 1600000, 2000000, 2400000].map(
    (from, i, a) => ({ from, to: a[i + 1] ?? null, rate: i * 5 }),
  ),
  mappings: [
    {
      componentId: 'fixture',
      type: 'taxable',
      legalReference:
        'Test-only ordinary-wage fixture, not a production approval',
    },
  ],
  employerContributionsReviewed: true,
  reviewNote: 'Isolated validation fixture',
  legalReferences: [
    'https://www.incometaxindia.gov.in/Documents/Act/Income-tax-Act-2025.pdf',
  ],
});
describe('Complete backend tax configuration validation', () => {
  it.each([
    ['standardDeduction', undefined],
    ['rebateLimit', undefined],
    ['maximumRebate', undefined],
    ['standardDeduction', -1],
    ['rebateLimit', -1],
    ['maximumRebate', -1],
    ['cessPercentage', -1],
    ['cessPercentage', 101],
    ['minimumAge', -1],
    ['minimumAge', 1.5],
    ['maximumAge', -1],
    ['maximumAge', 121],
    ['incomeRounding', 'invalid'],
    ['liabilityRounding', 'invalid'],
    ['rebateMarginalRelief', undefined],
    ['surchargeMarginalRelief', undefined],
    ['reviewNote', ' '],
    ['legalReferences', []],
    ['legalReferences', ['https://example.com/unapproved']],
    ['employerContributionsReviewed', false],
  ])('rejects invalid %s: %j', (field, value) =>
    expect(() =>
      validateRules({
        ...validationFixture(),
        [String(field)]: value,
      } as TaxRules),
    ).toThrow(),
  );
  it('allows both marginal relief flags to be explicitly disabled', () =>
    expect(
      validateRules({
        ...validationFixture(),
        rebateMarginalRelief: false,
        surchargeMarginalRelief: false,
      }),
    ).toBeDefined());
  it('allows unlimited maximum age and rejects a reversed age range', () => {
    expect(validateRules(validationFixture()).maximumAge).toBeNull();
    expect(() =>
      validateRules({ ...validationFixture(), minimumAge: 60, maximumAge: 59 }),
    ).toThrow('age');
  });
  it.each(
    [
      [],
      [{ from: 1, to: null, rate: 0 }],
      [
        { from: 0, to: 100, rate: 0 },
        { from: 99, to: null, rate: 5 },
      ],
      [
        { from: 0, to: 100, rate: 0 },
        { from: 101, to: null, rate: 5 },
      ],
      [
        { from: 0, to: 100, rate: 0 },
        { from: 0, to: null, rate: 5 },
      ],
      [{ from: -1, to: null, rate: 0 }],
      [{ from: 0, to: null, rate: -1 }],
      [{ from: 0, to: null, rate: 101 }],
      [{ from: 0, to: 100, rate: 0 }],
      [
        { from: 0, to: null, rate: 0 },
        { from: 100, to: null, rate: 5 },
      ],
    ].map((slabs) => [slabs]),
  )('rejects invalid slab set %#', (slabs) =>
    expect(() => validateRules({ ...validationFixture(), slabs })).toThrow(),
  );
  it('sorts valid reordered slabs without changing the submitted object', () => {
    const r = validationFixture();
    r.slabs.reverse();
    const before = JSON.stringify(r);
    expect(validateRules(r).slabs[0].from).toBe(0);
    expect(JSON.stringify(r)).toBe(before);
  });
  it.each(
    [
      [
        { threshold: 100, rate: 5 },
        { threshold: 100, rate: 10 },
      ],
      [
        { threshold: 200, rate: 5 },
        { threshold: 100, rate: 10 },
      ],
      [{ threshold: -1, rate: 10 }],
      [{ threshold: 100, rate: -1 }],
      [{ threshold: 100, rate: 101 }],
      [
        { threshold: 100, rate: 20 },
        { threshold: 200, rate: 10 },
      ],
    ].map((surcharge) => [surcharge]),
  )('rejects invalid surcharge set %#', (surcharge) =>
    expect(() =>
      validateRules({ ...validationFixture(), surcharge }),
    ).toThrow(),
  );
  it('allows no surcharge tiers', () =>
    expect(
      validateRules({ ...validationFixture(), surcharge: [] }).surcharge,
    ).toEqual([]));
  it.each(['taxable', 'exempt', 'partial', 'conditional'] as const)(
    'allows reviewed %s mapping metadata',
    (type) => {
      const r = validationFixture();
      r.mappings[0] = {
        ...r.mappings[0],
        type,
        conditions: 'Fixture condition',
        ...(type === 'partial' ? { taxablePercentage: 50 } : {}),
      };
      expect(validateRules(r)).toBeDefined();
    },
  );
  it('continues blocking conditional claims in actual tax calculation', () => {
    const r = validationFixture();
    r.mappings[0] = {
      ...r.mappings[0],
      type: 'conditional',
      conditions: 'Requires claims approval',
    };
    expect(() =>
      calculateAnnualTax(
        {
          annual: { annualCtc: 1000000, annualGrossWages: 1000000 },
          components: [
            {
              componentId: 'fixture',
              code: 'FIXTURE',
              category: 'earning',
              annual: 1000000,
            },
          ],
        },
        r,
      ),
    ).toThrow('future claims');
  });
  it('rejects missing identities, duplicate mappings and missing legal evidence', () => {
    const r = validationFixture();
    expect(() =>
      validateRules({
        ...r,
        mappings: [{ ...r.mappings[0], componentId: '' }],
      }),
    ).toThrow();
    expect(() =>
      validateRules({ ...r, mappings: [r.mappings[0], r.mappings[0]] }),
    ).toThrow();
    expect(() =>
      validateRules({
        ...r,
        mappings: [{ ...r.mappings[0], legalReference: '' }],
      }),
    ).toThrow();
    expect(() =>
      validateRules({
        ...r,
        mappings: [{ ...r.mappings[0], type: 'exempt', conditions: '' }],
      }),
    ).toThrow();
  });
});
