import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({
  collection: 'salary_components',
  timestamps: true,
  optimisticConcurrency: true,
})
export class SalaryComponent {
  @Prop({ required: true, default: false }) isSystemDefined!: boolean;
  @Prop({ type: Object }) legacyCalculation?: {
    calculationType: string;
    calculationValue: number;
    fixedAmountPeriod: string | null;
  };
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  code!: string;
  @Prop({ required: true, enum: ['earning', 'deduction', 'allowance'] })
  category!: 'earning' | 'deduction' | 'allowance';
  @Prop({
    required: true,
    enum: ['annual_ctc', 'gross_wages', 'core_wages', 'salary_component'],
  })
  calculationBaseType!:
    'annual_ctc' | 'gross_wages' | 'core_wages' | 'salary_component';
  @Prop({ type: Types.ObjectId, ref: 'SalaryComponent', default: null })
  calculationBaseComponentId!: Types.ObjectId | null;
  @Prop({ required: true, enum: ['percentage', 'fixed', 'formula'] })
  calculationType!: 'percentage' | 'fixed' | 'formula';
  @Prop({
    type: Number,
    required: function (this: SalaryComponent) {
      return !this.isSystemDefined && this.calculationType !== 'formula';
    },
    min: 0,
    validate: (value: number | null) =>
      value === null || Number.isFinite(value),
  })
  calculationValue!: number | null;
  @Prop({ type: String, default: null, maxlength: 1024 }) formula?:
    string | null;
  @Prop({ type: String, enum: ['annual', 'monthly', null], default: null })
  fixedAmountPeriod!: 'annual' | 'monthly' | null;
  @Prop({ required: true, default: true }) showInPayslip!: boolean;
  @Prop({ required: true, enum: ['active', 'inactive'], default: 'active' })
  status!: 'active' | 'inactive';
}
export const SalaryComponentSchema =
  SchemaFactory.createForClass(SalaryComponent);
