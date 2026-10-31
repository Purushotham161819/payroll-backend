import { Schema } from 'mongoose';
import type { PayrollTaxSnapshot } from '../../income-tax/income-tax.service';

export interface PayCheckSnapshot {
  id: string;
  employeeId: string;
  employeeCode?: string;
  firstName: string;
  lastName: string;
  grossPay: number;
  employerContributions: number;
  deductions: number;
  netPay: number;
  tds?: number;
  tdsCalculationStatus?: string;
  tdsCalculationStatusLabel?: string;
  existingDeductions?: number;
  tax?: PayrollTaxSnapshot;
  components: {
    name: string;
    category: string;
    amount: number;
    showInPayslip: boolean;
  }[];
  calculation: unknown;
  pdf?: string;
}
export interface PayrollRun {
  organizationId: string;
  organizationName: string;
  period: string;
  periodStart: Date;
  periodEnd: Date;
  status: 'Draft' | 'Submitted';
  version: number;
  calculationVersion: string;
  inputHash: string;
  calculationInputs: unknown;
  calculatedAt: Date;
  checks: PayCheckSnapshot[];
  totals: { employerContributions: number; deductions: number; netPay: number };
  createdBy: string;
  updatedBy: string;
  submittedBy?: string;
  submittedAt?: Date;
  paymentDate?: string | null;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
  pendingDraft?: PayrollRun;
  additionalSubmissions?: PayrollRun[];
}
// Individual checks and their PDFs are embedded in the period aggregate. A single
// compare-and-swap commits the entire submission, including every PDF, on both
// standalone MongoDB and replica sets. No partially finalized records can exist.
export const PayrollRunSchema: Schema<PayrollRun> = new Schema<PayrollRun>(
  {
    organizationId: { type: String, required: true },
    organizationName: { type: String, required: true },
    period: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ['Draft', 'Submitted'], required: true },
    version: { type: Number, required: true },
    calculationVersion: { type: String, required: true },
    inputHash: { type: String, required: true },
    calculationInputs: { type: Schema.Types.Mixed, required: true },
    calculatedAt: { type: Date, required: true },
    checks: { type: Schema.Types.Mixed, required: true },
    totals: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
    submittedBy: String,
    submittedAt: Date,
    paymentDate: String,
    idempotencyKey: String,
    pendingDraft: { type: Schema.Types.Mixed },
    additionalSubmissions: { type: Schema.Types.Mixed },
  },
  { collection: 'payroll_runs', timestamps: true },
);
PayrollRunSchema.index({ organizationId: 1, period: 1 }, { unique: true });
PayrollRunSchema.index({
  organizationId: 1,
  'checks.employeeId': 1,
  status: 1,
  period: -1,
});
PayrollRunSchema.index({
  organizationId: 1,
  'additionalSubmissions.checks.employeeId': 1,
  status: 1,
  period: -1,
});
