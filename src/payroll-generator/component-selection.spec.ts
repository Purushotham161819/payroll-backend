import { PayrollGeneratorService } from './payroll-generator.service';
import { SalaryCalculationService } from './salary-calculation.service';

describe('Dynamic report component selection', () => {
  const records = [
    ...['BASIC', 'DA', 'RA'].map((code, i) => ({
      _id: code,
      code,
      name: code,
      category: 'earning',
      status: 'active',
      calculationType: 'percentage',
      calculationValue: [40, 10, 15][i],
      calculationBaseType: 'annual_ctc',
      showInPayslip: true,
    })),
    {
      _id: 'travel',
      code: 'TRAVEL',
      name: 'Travel & Meals',
      category: 'allowance',
      status: 'active',
      calculationType: 'fixed',
      calculationValue: 120,
      fixedAmountPeriod: 'monthly',
      calculationBaseType: 'annual_ctc',
      showInPayslip: false,
    },
    {
      _id: 'bonus',
      code: 'BONUS',
      name: 'Bonus',
      category: 'earning',
      status: 'active',
      calculationType: 'percentage',
      calculationValue: 10,
      calculationBaseType: 'salary_component',
      calculationBaseComponentId: 'BASIC',
      showInPayslip: true,
    },
    {
      _id: 'old',
      code: 'OLD',
      name: 'Old',
      category: 'earning',
      status: 'inactive',
    },
  ];
  const service = () =>
    new PayrollGeneratorService(
      {
        find: () => ({
          lean: () => ({ exec: async () => [{ annualCtc: 107500 }] }),
        }),
      } as never,
      { findAll: async () => records } as never,
      {
        get: async () => ({
          epsEmployerContributionPercentage: 8,
          epfEmployerContributionPercentage: 4,
          esiEmployerContributionPercentage: 3,
        }),
      } as never,
      new SalaryCalculationService(),
    );
  it('retrieves and calculates new components while selection only changes metadata', async () => {
    const all = await service().annual();
    const selected = await service().annual(['bonus', 'travel']);
    const none = await service().annual([]);
    expect(all.components).toEqual(records);
    expect(selected.reportComponents.map((c) => c.componentId)).toEqual([
      'BASIC',
      'DA',
      'RA',
      'travel',
      'bonus',
    ]);
    expect(none.reportComponents.map((c) => c.componentId)).toEqual([
      'BASIC',
      'DA',
      'RA',
    ]);
    expect(selected.employees).toEqual(all.employees);
    expect(none.employees).toEqual(all.employees);
    expect(all.employees[0].calculation.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: 'travel',
          annual: 1440,
          monthly: 120,
        }),
        expect.objectContaining({ componentId: 'bonus', annual: 4000 }),
      ]),
    );
  });
  it.each(['unknown', null, {}, ['unknown'], ['old'], [null]])(
    'rejects invalid selection %p',
    async (ids) => {
      await expect(service().annual(ids)).rejects.toThrow(
        'valid active salary component IDs',
      );
    },
  );
});
