import { annualPayroll } from './annual-payroll';
import { CalculationComponent } from './salary-calculation.service';
import { validateFormulaGraph } from '../salary-components/formula-graph';
const core = (): CalculationComponent[] =>
  ['BASIC', 'DA', 'RA'].map((code, i) => ({
    _id: '00000000000000000000000' + (i + 1),
    code,
    category: 'earning',
    calculationBaseType: 'annual_ctc',
    calculationType: 'percentage',
    calculationValue: [40, 10, 15][i],
    status: 'active',
    showInPayslip: true,
  }));
const component = (
  formula: string,
  category: 'deduction' | 'allowance' | 'earning' = 'deduction',
): CalculationComponent => ({
  _id: '000000000000000000000004',
  code: 'IF_TEST',
  category,
  calculationType: 'formula',
  formula,
  calculationValue: null,
  calculationBaseType: 'annual_ctc',
  status: 'active',
  showInPayslip: true,
});
const settings = {
  wageCap: 180000,
  annualEsiCeilingLimit: 60000,
  epsEmployerContributionPercentage: 8,
  epfEmployerContributionPercentage: 4,
  esiEmployerContributionPercentage: 3,
  esiEmployeeContributionPercentage: 0.75,
  epfEmployeeContributionPercentage: 12,
};
const esi =
  'IF(Compliance Wage Base <= Annual ESI Wage Ceiling Limit, Compliance Wage Base * ESI Employee Contribution Rate, 0)';
describe('Conditional formulas in the annual engine', () => {
  it.each([
    [107500, 375, 31.25],
    [215000, 0, 0],
  ])(
    'calculates the example ESI condition from annual values for employee CTC %s',
    (ctc, annual, monthly) => {
      const c = component(esi);
      const result = annualPayroll(ctc, [...core(), c], settings);
      expect(result.components.at(-1)).toMatchObject({ annual, monthly });
      expect(result.annual.annualTotalDeductions).toBe(annual);
      expect(result.annual.annualNetPay).toBe(
        result.annual.annualGrossWages - annual,
      );
      expect(() =>
        validateFormulaGraph([...core(), c], '000000000000000000000004'),
      ).not.toThrow();
    },
  );
  it('selects THEN at the inclusive boundary using the approved employer eligibility preference', () => {
    expect(
      annualPayroll(107500, [...core(), component(esi)], {
        ...settings,
        annualEsiCeilingLimit: 50000,
      }).components.at(-1)?.annual,
    ).toBe(375);
  });
  it('resolves allowance totals, excess, statutory employer amounts and saved decimal rates', () => {
    const allowance: CalculationComponent = {
      ...component('annualGrossWages * 70%', 'allowance'),
      _id: '000000000000000000000005',
      code: 'ALLOW',
    };
    const c = component(
      'IF(annualTotalAllowances > 0, annualExcessAllowance + employerEpfContribution + employerEpsContribution + employerEsiContribution + annualComplianceWageBase * epfEmployeeContributionRate, 0)',
    );
    const result = annualPayroll(108100, [...core(), allowance, c], settings),
      a = result.annual;
    expect(result.components.at(-1)?.annual).toBeCloseTo(
      a.annualExcessAllowance +
        a.employerEpfContribution +
        a.employerEpsContribution +
        a.employerEsiContribution +
        a.annualComplianceWageBase * 0.12,
      1,
    );
  });
  it('supports nested IF and stable custom component references without changing previous amounts', () => {
    const other = {
      ...component('annualCtc * 1%', 'earning'),
      _id: '000000000000000000000005',
      code: 'OTHER',
    };
    const result = annualPayroll(
      107500,
      [
        ...core(),
        other,
        component(
          'IF(component_000000000000000000000005 > 1000, IF(annualBasicSalary > 10000, MIN(annualCoreWages, annualEpfCeilingLimit)*1%,0),0)',
        ),
      ],
      settings,
    );
    expect(result.components.at(-1)?.annual).toBe(500);
    expect(result.components.at(-2)?.annual).toBe(1075);
  });
  it('rejects allowance aggregate self-cycles, including a self-reference hidden in an ELSE branch', () => {
    for (const text of [
      'IF(annualComplianceWageBase>1,1,0)',
      'IF(1=1,1,annualTotalAllowances)',
    ]) {
      const c = component(text, 'allowance');
      expect(() =>
        validateFormulaGraph([...core(), c], c._id.toString()),
      ).toThrow('Circular');
    }
    expect(() =>
      annualPayroll(
        107500,
        [
          ...core(),
          component('IF(annualComplianceWageBase>1,1,0)', 'allowance'),
        ],
        settings,
      ),
    ).toThrow('Circular');
  });
  it('revalidates dependencies before evaluation even when a circular branch would not be selected', () => {
    expect(() =>
      annualPayroll(
        107500,
        [...core(), component('IF(1=1,1,component_000000000000000000000004)')],
        settings,
      ),
    ).toThrow('Circular');
  });
  it('reports missing settings and zero division in a selected branch', () => {
    expect(() =>
      annualPayroll(107500, [...core(), component(esi)], {
        ...settings,
        esiEmployeeContributionPercentage: undefined,
      }),
    ).toThrow('esiEmployeeContributionRate');
    expect(() =>
      annualPayroll(
        107500,
        [...core(), component('IF(annualCtc>0,1/(annualCtc-annualCtc),0)')],
        settings,
      ),
    ).toThrow('zero');
  });
});
