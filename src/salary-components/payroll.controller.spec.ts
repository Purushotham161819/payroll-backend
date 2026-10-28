import { PayrollController } from './payroll.controller';
import { SalaryCalculationService } from './salary-calculation.service';

describe('Saved-data annual payroll endpoint', () => {
  it('uses saved CTC, components and settings without writing records', async () => {
    const employee = {
      _id: 'employee',
      firstName: 'A',
      lastName: 'B',
      annualCtc: 107500,
    };
    const records = ['BASIC', 'DA', 'RA'].map((code, i) => ({
      _id: code,
      code,
      category: 'earning',
      status: 'active',
      calculationType: 'percentage',
      calculationValue: [40, 10, 15][i],
      calculationBaseType: 'annual_ctc',
      showInPayslip: true,
    }));
    const config = {
      epsEmployerContributionPercentage: 8,
      epfEmployerContributionPercentage: 4,
      esiEmployerContributionPercentage: 3,
    };
    const before = JSON.stringify({ employee, records, config });
    const controller = new PayrollController(
      {
        find: jest
          .fn()
          .mockReturnValue({ lean: () => ({ exec: async () => [employee] }) }),
      } as never,
      { findAll: async () => records } as never,
      { get: async () => config } as never,
      new SalaryCalculationService(),
    );
    const result = await controller.annual();
    expect(result.employees[0].calculation.annual.annualGrossWages).toBe(
      100000,
    );
    expect(
      result.employees[0].calculation.annual.annualComplianceWageBase,
    ).toBe(50000);
    expect(JSON.stringify({ employee, records, config })).toBe(before);
  });
});
