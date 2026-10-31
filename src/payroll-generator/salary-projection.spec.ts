import {
  SalaryCalculationService,
  CalculationComponent,
} from './salary-calculation.service';

describe('TDS employment-period salary projection using the annual payroll engine', () => {
  const service = new SalaryCalculationService();
  const components: CalculationComponent[] = [
    ...[
      ['BASIC', 40],
      ['DA', 10],
      ['RA', 15],
    ].map(([code, value]) => ({
      _id: String(code),
      code: String(code),
      category: 'earning',
      calculationType: 'percentage',
      calculationBaseType: 'annual_ctc',
      calculationValue: Number(value),
      status: 'active',
      showInPayslip: true,
    })),
    {
      _id: 'travel',
      code: 'TRAVEL',
      category: 'allowance',
      calculationType: 'fixed',
      calculationBaseType: 'annual_ctc',
      calculationValue: 1000,
      fixedAmountPeriod: 'monthly',
      status: 'active',
      showInPayslip: true,
    },
    {
      _id: 'bonus',
      code: 'BONUS',
      category: 'allowance',
      calculationType: 'fixed',
      calculationBaseType: 'annual_ctc',
      calculationValue: 12000,
      fixedAmountPeriod: 'annual',
      status: 'active',
      showInPayslip: true,
    },
  ] as CalculationComponent[];
  const settings = {
    isEpfCeilingApplicable: true,
    wageCap: 180000,
    annualEsiCeilingLimit: 252000,
    epfEmployerContributionPercentage: 4,
    epsEmployerContributionPercentage: 8,
    esiEmployerContributionPercentage: 0,
  };
  it('prorates CTC, fixed allowances and the employer cap for seven months', () => {
    const result = service.calculateProjection(
      1600000,
      components,
      settings,
      7,
    );
    expect(result.annual.annualCtc).toBe(933333.33);
    expect(result.components.find((c) => c.code === 'TRAVEL')?.annual).toBe(
      7000,
    );
    expect(result.components.find((c) => c.code === 'BONUS')?.annual).toBe(
      7000,
    );
    expect(result.annual.employerEpfContribution).toBe(4200);
    expect(result.annual.employerEpsContribution).toBe(8400);
    expect(result.annual.annualGrossWages).toBe(920733.33);
    expect(components[3].calculationValue).toBe(1000);
    expect(settings.wageCap).toBe(180000);
  });
  it('retains the existing full-year results exactly', () => {
    expect(
      service.calculateProjection(1600000, components, settings, 12),
    ).toEqual(service.calculateAnnual(1600000, components, settings));
  });
});
