import { SalaryCalculationService } from '../payroll-generator/salary-calculation.service';
import type { CalculationComponent } from '../payroll-generator/salary-calculation.service';
import { monthlyAmount, sumMoney } from '../run-payroll/run-payroll.service';
import type { PayCheckSnapshot } from '../run-payroll/schemas/payroll-run.schema';
import { applyPayrollTax } from './payroll-tax';
import type { PayrollTaxSnapshot } from './income-tax.service';
describe('Mandatory payroll preservation acceptance', () => {
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
  components.push({
    _id: 'EPF',
    code: 'EPF',
    category: 'deduction',
    calculationBaseType: 'annual_ctc',
    calculationType: 'fixed',
    fixedAmountPeriod: 'monthly',
    calculationValue: 5000,
    showInPayslip: true,
    status: 'active',
  });
  const calculation = new SalaryCalculationService().calculateAnnual(
    1200000,
    components,
    {
      epsEmployerContributionPercentage: 8,
      epfEmployerContributionPercentage: 4,
      esiEmployerContributionPercentage: 3,
    },
  );
  const a = calculation.annual;
  const before: PayCheckSnapshot = {
    id: 'employee',
    employeeId: 'employee',
    firstName: 'Test',
    lastName: 'Employee',
    grossPay: monthlyAmount(a.annualGrossWages),
    employerContributions: sumMoney(
      [
        a.employerEpfContribution,
        a.employerEpsContribution,
        a.employerEsiContribution,
      ].map(monthlyAmount),
    ),
    deductions: monthlyAmount(a.annualTotalDeductions),
    netPay: monthlyAmount(a.annualNetPay),
    components: calculation.components.map((c) => ({
      name: c.code,
      category: c.category,
      amount: c.monthly,
      showInPayslip: c.showInPayslip,
    })),
    calculation,
  };
  const tax: PayrollTaxSnapshot = {
    calculationId: 'snapshot',
    inputHash: 'hash',
    yearCode: 'test',
    regime: 'new',
    legislation: 'Fixture',
    configurationVersion: 'v1',
    profileVersion: 1,
    annualTds: 36000,
    allocation: Array(12).fill(3000),
    monthIndex: 0,
    amount: 3000,
  };
  it('leaves every legacy payroll value identical with TDS disabled', () => {
    expect(applyPayrollTax(before)).toBe(before);
    expect(applyPayrollTax(before)).toEqual(before);
  });
  it('preserves Gross, CTC, statutory deductions and employer contributions; reduces Net exactly once', () => {
    const original = JSON.stringify(before),
      after = applyPayrollTax(before, tax);
    expect(after.grossPay).toBe(before.grossPay);
    expect(after.employerContributions).toBe(before.employerContributions);
    expect(after.existingDeductions).toBe(before.deductions);
    expect(after.deductions).toBe(before.deductions + 3000);
    expect(after.netPay).toBe(before.netPay - 3000);
    expect(after.calculation).toBe(calculation);
    expect(
      after.components.filter((c) => c.name === 'Income Tax / TDS'),
    ).toHaveLength(1);
    expect(JSON.stringify(before)).toBe(original);
    expect(applyPayrollTax(before, tax)).toEqual(after);
    expect(() => applyPayrollTax(after, tax)).toThrow('already included');
  });
  it('blocks unaffordable or negative deductions', () => {
    expect(() =>
      applyPayrollTax(before, { ...tax, amount: before.netPay + 1 }),
    ).toThrow();
    expect(() => applyPayrollTax(before, { ...tax, amount: -1 })).toThrow();
  });
});
