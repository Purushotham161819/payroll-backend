import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { DEFAULT_PAY_FREQUENCY, PAY_FREQUENCIES } from '../pay-frequency';

export type EmployeeDocument = HydratedDocument<Employee>;

@Schema({ collection: 'employees', timestamps: true, autoIndex: false })
export class Employee {
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
