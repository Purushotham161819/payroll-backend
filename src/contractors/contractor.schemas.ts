import { Schema } from 'mongoose';
const options = {
  timestamps: true,
  versionKey: false,
  autoCreate: false,
  autoIndex: false,
} as const;
export const ContractorSchema = new Schema(
  {
    organizationId: { type: String, required: true, immutable: true },
    contractorId: { type: String, required: true, immutable: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    componentIds: { type: [String], default: [] },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    paymentWriteVersion: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    createdBy: String,
    updatedBy: String,
  },
  { ...options, collection: 'contractors' },
);
ContractorSchema.index({ organizationId: 1, email: 1 }, { unique: true });
ContractorSchema.index(
  { organizationId: 1, contractorId: 1 },
  { unique: true },
);
export const ContractorComponentSchema = new Schema(
  {
    organizationId: { type: String, required: true, immutable: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    classification: {
      type: String,
      enum: ['earning', 'allowance', 'deduction'],
      required: true,
    },
    status: { type: String, enum: ['active', 'inactive'], required: true },
    calculationType: {
      type: String,
      enum: ['manual', 'fixed', 'percentage', 'formula'],
      required: true,
    },
    calculationValue: Number,
    calculationBase: String,
    formula: String,
    version: { type: Number, default: 0 },
    createdBy: String,
    updatedBy: String,
  },
  { ...options, collection: 'contractor_components' },
);
ContractorComponentSchema.index(
  { organizationId: 1, code: 1 },
  { unique: true },
);
const line = new Schema(
  {
    componentId: String,
    componentVersion: Number,
    name: String,
    code: String,
    classification: String,
    amount: Number,
    calculationType: String,
    calculationValue: Number,
    calculationBase: String,
    formula: String,
  },
  { _id: false },
);
const entry = new Schema(
  {
    description: String,
    paymentId: String,
    contractorId: String,
    contractorCode: String,
    firstName: String,
    lastName: String,
    email: String,
    components: [line],
    calculationVersion: Number,
    grossPay: Number,
    totalEarnings: Number,
    totalAllowances: Number,
    totalDeductions: Number,
    netPayment: Number,
  },
  { _id: false },
);
export const ContractorPaymentSchema = new Schema(
  {
    organizationId: { type: String, required: true, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    inputHash: { type: String, required: true, immutable: true },
    paymentDate: { type: String, required: true, immutable: true },
    description: { type: String, immutable: true },
    entries: { type: [entry], required: true, immutable: true },
    recordedBy: { type: String, required: true, immutable: true },
  },
  { ...options, collection: 'contractor_payments' },
);
ContractorPaymentSchema.index(
  { organizationId: 1, idempotencyKey: 1 },
  { unique: true },
);
ContractorPaymentSchema.index({
  organizationId: 1,
  'entries.contractorId': 1,
  paymentDate: -1,
  createdAt: -1,
});
export const ContractorCounterSchema = new Schema(
  { _id: String, value: { type: Number, required: true } },
  {
    versionKey: false,
    collection: 'contractor_counters',
    autoCreate: false,
    autoIndex: false,
  },
);
