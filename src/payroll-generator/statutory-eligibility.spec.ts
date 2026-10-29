import { annualPayroll } from './annual-payroll';
import { CalculationComponent } from './salary-calculation.service';
const components: CalculationComponent[] = ['BASIC', 'DA', 'RA'].map(
  (code, i) => ({
    _id: code,
    code,
    category: 'earning',
    calculationBaseType: 'annual_ctc',
    calculationType: 'percentage',
    calculationValue: [40, 10, 15][i],
    showInPayslip: true,
    status: 'active',
  }),
);
const rates = {
  wageCap: 50000,
  epsEmployerContributionPercentage: 8,
  epfEmployerContributionPercentage: 4,
  esiEmployerContributionPercentage: 3,
};
describe('EPF ceiling applicability', () => {
  it.each([
    [53750, 2000, 1000],
    [107500, 4000, 2000],
    [207500, 4000, 2000],
  ])(
    'caps employer contributions using configured core base for CTC %s',
    (ctc, eps, epf) => {
      const a = annualPayroll(ctc, components, {
        ...rates,
        isEpfCeilingApplicable: true,
      }).annual;
      expect(a.employerEpsContribution).toBe(eps);
      expect(a.employerEpfContribution).toBe(epf);
      expect(a.annualGrossWages).toBeCloseTo(
        ctc - eps - epf - a.employerEsiContribution,
        1,
      );
    },
  );
  it('keeps disabled and absent settings identical, including formula results and Net Pay', () => {
    expect(
      annualPayroll(215000, components, {
        ...rates,
        isEpfCeilingApplicable: false,
      }),
    ).toEqual(annualPayroll(215000, components, rates));
    expect(
      annualPayroll(215000, components, rates).annual.employerEpsContribution,
    ).toBe(8000);
  });
  it('requires a valid EPF ceiling only when enabled', () => {
    expect(() =>
      annualPayroll(107500, components, {
        ...rates,
        wageCap: undefined,
        isEpfCeilingApplicable: true,
      }),
    ).toThrow('Annual EPF Ceiling Limit');
    expect(() =>
      annualPayroll(107500, components, {
        ...rates,
        wageCap: undefined,
        isEpfCeilingApplicable: false,
      }),
    ).not.toThrow();
  });
});

describe('Employer ESI eligibility independent of the EPF checkbox', () => {
  it.each([false, true])(
    'calculates eligible employer ESI below the annual ceiling with EPF checkbox %s',
    (isEpfCeilingApplicable) => {
      const a = annualPayroll(107500, components, {
        ...rates,
        isEpfCeilingApplicable,
        annualEsiCeilingLimit: 60000,
      }).annual;
      expect(a.annualComplianceWageBase).toBeLessThanOrEqual(60000);
      expect(a.employerEsiContribution).toBeCloseTo(
        a.annualComplianceWageBase * 0.03,
        1,
      );
    },
  );
  it.each([false, true])(
    'returns numeric zero above the annual ESI ceiling with EPF checkbox %s',
    (isEpfCeilingApplicable) => {
      const a = annualPayroll(107500, components, {
        ...rates,
        isEpfCeilingApplicable,
        annualEsiCeilingLimit: 40000,
      }).annual;
      expect(a.annualComplianceWageBase).toBeGreaterThan(40000);
      expect(a.employerEsiContribution).toBe(0);
      expect(a.annualGrossWages).toBeCloseTo(
        107500 - a.employerEpsContribution - a.employerEpfContribution,
        1,
      );
    },
  );
  it('leaves manually configured employee ESI deductions unchanged when employer ESI is ineligible', () => {
    const employeeEsi: CalculationComponent = {
      _id: 'EMPLOYEE_ESI',
      code: 'EMPLOYEE_ESI',
      category: 'deduction',
      calculationBaseType: 'annual_ctc',
      calculationType: 'percentage',
      calculationValue: 0.75,
      showInPayslip: true,
      status: 'active',
    };
    const result = annualPayroll(107500, [...components, employeeEsi], {
      ...rates,
      annualEsiCeilingLimit: 40000,
    });
    expect(result.components.at(-1)?.annual).toBe(806.25);
    expect(result.annual.employerEsiContribution).toBe(0);
    expect(result.annual.annualTotalDeductions).toBe(806.25);
  });
  it('preserves the existing uncapped ESI behavior when old settings have no ESI ceiling', () => {
    expect(
      annualPayroll(107500, components, rates).annual.employerEsiContribution,
    ).toBe(1500);
  });
});

describe('Employer ESI threshold boundary and approved tie-break', () => {
  it('includes equality and prefers the eligible employer ESI solution when both branches are self-consistent', () => {
    const result = annualPayroll(107500, components, {
      ...rates,
      annualEsiCeilingLimit: 50000,
    });
    expect(result.annual.annualComplianceWageBase).toBe(50000);
    expect(result.annual.employerEsiContribution).toBe(1500);
    expect(result.diagnostics.employerEsiEligible).toBe(true);
  });
  it('applies the eligibility rule consistently through formula MIN/MAX branches', () => {
    const formula: CalculationComponent = {
      _id: 'FORMULA',
      code: 'FORMULA',
      category: 'allowance',
      calculationBaseType: 'annual_ctc',
      calculationType: 'formula',
      formula: 'MIN(annualGrossWages * 70%, 70000)',
      calculationValue: null,
      showInPayslip: true,
      status: 'active',
    };
    const result = annualPayroll(108100, [...components, formula], {
      ...rates,
      annualEsiCeilingLimit: 70000,
    });
    expect(result.annual.annualComplianceWageBase).toBe(70000);
    expect(result.annual.employerEsiContribution).toBe(2100);
    expect(result.diagnostics.employerEsiEligible).toBe(true);
  });
  it('validates missing/invalid settings without inferring statutory amounts', () => {
    expect(() =>
      annualPayroll(107500, components, {
        ...rates,
        annualEsiCeilingLimit: -1,
      }),
    ).toThrow('Annual ESI Wage Ceiling Limit');
    expect(() =>
      annualPayroll(107500, components, {
        ...rates,
        isEpfCeilingApplicable: 'true' as never,
      }),
    ).toThrow('applicability');
  });
});
