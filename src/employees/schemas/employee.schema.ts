import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { DEFAULT_PAY_FREQUENCY, PAY_FREQUENCIES } from '../pay-frequency';

export type EmployeeDocument = HydratedDocument<Employee>;

@Schema({ _id: false })
export class EmploymentPeriod {
  @Prop({ type: Date, required: true })
  startDate!: Date;
  @Prop({ type: Date })
  endDate?: Date;
  @Prop({ type: String })
  terminationReason?: string;
  @Prop({ type: String, maxlength: 250 })
  explanation?: string;
  @Prop({ type: Date, required: true })
  recordedAt!: Date;
  @Prop({ type: Date })
  terminatedAt?: Date;
}
const EmploymentPeriodSchema = SchemaFactory.createForClass(EmploymentPeriod);

@Schema({ collection: 'employees', timestamps: true, autoIndex: false })
export class Employee {
  @Prop({ type: String, enum: ['Active', 'Terminated'], default: 'Active' })
  status!: 'Active' | 'Terminated';

  @Prop({ type: [EmploymentPeriodSchema], default: undefined })
  employmentHistory?: EmploymentPeriod[];

  @Prop({ type: Date })
  rehireDate?: Date;

  @Prop({ type: Number, default: 0 })
  lifecycleVersion!: number;
  @Prop({ type: String, immutable: true, match: /^EMP\d{3,}$/ })
  employeeId?: string;
  @Prop({
    type: String,
    enum: PAY_FREQUENCIES,
    default: DEFAULT_PAY_FREQUENCY,
    required: true,
  })
  payFrequency!: (typeof PAY_FREQUENCIES)[number];

  @Prop({ required: true, trim: true, lowercase: true, unique: true })
  email!: string;

  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ required: true, trim: true })
  lastName!: string;

  @Prop({ type: Date, required: true })
  dateOfBirth!: Date;

  @Prop({ type: Date, required: true })
  hireDate!: Date;

  @Prop({ required: true, min: 0 })
  annualCtc!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);
