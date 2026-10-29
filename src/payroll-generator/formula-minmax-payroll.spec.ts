import { annualPayroll } from './annual-payroll';
import { CalculationComponent } from './salary-calculation.service';
const core = (): CalculationComponent[] =>
  ['BASIC', 'DA', 'RA'].map((code, i) => ({
    _id: code,
    code,
    category: 'earning',
    calculationBaseType: 'annual_ctc',
    calculationType: 'percentage',
    calculationValue: [40, 10, 15][i],
    showInPayslip: true,
    status: 'active',
  }));
const formula = (
  expression: string,
  category: 'deduction' | 'allowance' = 'deduction',
): CalculationComponent => ({
  _id: '000000000000000000000004',
  code: 'FORMULA',
  category,
  calculationBaseType: 'annual_ctc',
  calculationType: 'formula',
  formula: expression,
  calculationValue: null,
  showInPayslip: true,
  status: 'active',
});
const rates = {
  wageCap: 180000,
  annualEsiCeilingLimit: 252000,
  epsEmployerContributionPercentage: 8,
  epfEmployerContributionPercentage: 4,
  esiEmployerContributionPercentage: 3,
};
describe('MIN/MAX integrated with annual payroll equations', () => {
  it.each([
    [107500, 6000, 500],
    [430000, 21600, 1800],
  ])(
    'uses annual calculated Core Wages and configured EPF ceiling for CTC %s',
    (ctc, annual, monthly) => {
      const baseline = annualPayroll(ctc, core(), rates),
        result = annualPayroll(
          ctc,
          [
            ...core(),
            formula('MIN(Annual Core Wages, Annual EPF Ceiling Limit) * 12%'),
          ],
          rates,
        );
      expect(result.components.at(-1)).toMatchObject({ annual, monthly });
      expect(result.annual.annualNetPay).toBe(
        result.annual.annualGrossWages - annual,
      );
      for (const [key, value] of Object.entries(baseline.annual))
        if (!['annualNetPay', 'annualTotalDeductions'].includes(key))
          expect(result.annual[key]).toBe(value);
    },
  );
  it.each([107500, 108100, 215000])(
    'solves capped formula allowances without changing the existing ESI/excess equations at CTC %s',
    (ctc) => {
      const result = annualPayroll(
          ctc,
          [
            ...core(),
            formula('MIN(Annual Gross Wages * 70%, 70000)', 'allowance'),
          ],
          rates,
        ),
        a = result.annual;
      expect(a.annualTotalAllowances).toBeCloseTo(
        Math.min(a.annualGrossWages * 0.7, 70000),
        1,
      );
      expect(a.annualExcessAllowance).toBeCloseTo(
        Math.max(0, a.annualTotalAllowances - a.annualGrossWages / 2),
        1,
      );
      expect(a.employerEsiContribution).toBeCloseTo(
        a.annualComplianceWageBase * 0.03,
        1,
      );
      expect(a.annualGrossWages).toBeCloseTo(
        ctc -
          a.employerEpsContribution -
          a.employerEpfContribution -
          a.employerEsiContribution,
        1,
      );
      expect(result.diagnostics.equationResidual).toBe(0);
    },
  );
  it('handles ties deterministically, nested branches and MAX', () => {
    const result = annualPayroll(
      107500,
      [
        ...core(),
        formula(
          'MAX(Annual Basic Salary, 15000) * 10% + MIN(MAX(Annual Core Wages, 50000), 50000) * 1%',
        ),
      ],
      rates,
    );
    expect(result.components.at(-1)?.annual).toBe(4500);
  });
  it('bounds piecewise branch exploration instead of performing unbounded work', () => {
    const expression = Array.from(
      { length: 8 },
      (_, i) => 'MIN(annualGrossWages,' + (i + 1) + ')',
    ).join('+');
    expect(() =>
      annualPayroll(107500, [...core(), formula(expression)], rates),
    ).toThrow('256 branch');
  });
  it('uses configured ceiling values without changing their annual units', () => {
    expect(
      annualPayroll(
        107500,
        [
          ...core(),
          formula('MIN(Annual Core Wages, Annual EPF Ceiling Limit) * 12%'),
        ],
        { ...rates, wageCap: 15000 },
      ).components.at(-1)?.annual,
    ).toBe(1800);
    expect(
      annualPayroll(
        107500,
        [
          ...core(),
          formula('MIN(Annual Core Wages, Annual ESI Wage Ceiling Limit) * 1%'),
        ],
        rates,
      ).components.at(-1)?.annual,
    ).toBe(500);
  });
  it('rejects missing statutory settings and direct or nested dependency cycles', () => {
    expect(() =>
      annualPayroll(
        107500,
        [
          ...core(),
          formula('MIN(Annual Core Wages, Annual EPF Ceiling Limit)'),
        ],
        { ...rates, wageCap: undefined },
      ),
    ).toThrow('annualEpfCeilingLimit');
    expect(() =>
      annualPayroll(
        107500,
        [
          ...core(),
          formula('MIN(component_000000000000000000000004, annualCoreWages)'),
        ],
        rates,
      ),
    ).toThrow('Circular');
  });
});
