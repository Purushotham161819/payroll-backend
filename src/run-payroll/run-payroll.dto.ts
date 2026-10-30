export interface RunRequest {
  period: string;
  employeeIds: string[];
  version?: number;
  inputHash?: string;
  recalculate?: boolean;
  paymentDate?: string | null;
}
export interface SubmitPayrollRequest {
  version: number;
  paymentDate: string;
  idempotencyKey: string;
}
