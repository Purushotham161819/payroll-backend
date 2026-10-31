import { BadRequestException } from '@nestjs/common';
import { Ratio } from '../payroll-generator/decimal-ratio';
import type { PayCheckSnapshot } from '../run-payroll/schemas/payroll-run.schema';
import type { PayrollTaxSnapshot } from './income-tax.service';

// Only post-process a fresh existing payroll result. Never recalculate Gross,
// employer contributions or statutory deductions, and never compound prior TDS.
export function applyPayrollTax(
  check: PayCheckSnapshot,
  tax?: PayrollTaxSnapshot,
): PayCheckSnapshot {
  if (!tax) return check;
  if (check.tax)
    throw new BadRequestException('TDS is already included in this check.');
  if (
    !Number.isFinite(tax.amount) ||
    tax.amount < 0 ||
    tax.amount > check.netPay
  )
    throw new BadRequestException(
      'TDS exceeds available Net Pay. Review the allocation before payroll.',
    );
  return {
    ...check,
    tax,
    tds: tax.amount,
    existingDeductions: check.deductions,
    deductions: Ratio.of(check.deductions).add(Ratio.of(tax.amount)).money(),
    netPay: Ratio.of(check.netPay).sub(Ratio.of(tax.amount)).money(),
    components: [
      ...check.components,
      {
        name: 'Income Tax / TDS',
        category: 'deduction',
        amount: tax.amount,
        showInPayslip: true,
      },
    ],
  };
}
