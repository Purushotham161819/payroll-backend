import { payslipPdf } from './payslip';
import { PayCheckSnapshot } from './schemas/payroll-run.schema';

const snapshot = (): PayCheckSnapshot => ({
  id: 'employee',
  employeeId: 'employee',
  employeeCode: 'EMP001',
  firstName: 'Ada',
  lastName: 'Example',
  grossPay: 1000,
  employerContributions: 75,
  deductions: 50,
  netPay: 950,
  calculation: {},
  components: [
    {
      name: 'Visible salary',
      category: 'earning',
      amount: 1000,
      showInPayslip: true,
    },
    {
      name: 'Private internal earning',
      category: 'earning',
      amount: 123,
      showInPayslip: false,
    },
    {
      name: 'Visible deduction',
      category: 'deduction',
      amount: 50,
      showInPayslip: true,
    },
    {
      name: 'Private internal deduction',
      category: 'deduction',
      amount: 12,
      showInPayslip: false,
    },
  ],
});
describe('Individual payslip PDF from finalized snapshot', () => {
  it('includes only visible named components and prints engine amounts without recalculating', () => {
    const bytes = Buffer.from(
      payslipPdf('Example Organization', '2026-01', '2026-02-05', snapshot()),
      'base64',
    );
    const text = bytes.toString();
    expect(text).toContain('%PDF-');
    for (const value of [
      'Example Organization',
      'January 2026',
      '2026-02-05',
      'EMP001',
      'Visible salary',
      'Visible deduction',
      'INR 950.00',
      'INR 75.00',
    ])
      expect(text).toContain(value);
    expect(text).not.toContain('Private internal');
    expect(text).toContain('Total Employee Deductions');
    expect(text).toContain('Employer Contributions');
    expect(text).toContain('Payment has not been confirmed');
  });
  it('wraps long component names and adds pages while preserving configured order and totals', () => {
    const check = snapshot();
    check.components = Array.from({ length: 100 }, (_, index) => ({
      name:
        `Component ${String(index).padStart(3, '0')} ` +
        'Long salary component label '.repeat(6),
      category: 'earning',
      amount: 10,
      showInPayslip: true,
    }));
    const text = Buffer.from(
      payslipPdf('Example Organization', '2026-01', '2026-02-05', check),
      'base64',
    ).toString();
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect(text.indexOf('Component 000')).toBeLessThan(
      text.indexOf('Component 099'),
    );
    expect(text).toContain('NET Pay');
    expect(text).toContain('INR 950.00');
  });
});
