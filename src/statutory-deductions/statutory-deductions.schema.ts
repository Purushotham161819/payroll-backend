import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'statutory_deductions', timestamps: true })
export class StatutoryDeductions {
  @Prop({ type: Number, min: 0, validate: Number.isFinite })
  annualEsiCeilingLimit?: number;

  // The fixed MongoDB primary key makes concurrent upserts target one record.
  @Prop({ type: String, default: 'current', enum: ['current'] }) _id!: string;
  @Prop({ required: true, min: 0, validate: Number.isFinite }) wageCap!: number;
  @Prop({ required: true, min: 0, max: 100, validate: Number.isFinite })
  epfEmployerContributionPercentage!: number;
  @Prop({ required: true, min: 0, max: 100, validate: Number.isFinite })
  epsEmployerContributionPercentage!: number;
  @Prop({ required: true, min: 0, max: 100, validate: Number.isFinite })
  epfEmployeeContributionPercentage!: number;
  @Prop({ required: true, min: 0, max: 100, validate: Number.isFinite })
  esiEmployerContributionPercentage!: number;
  @Prop({ required: true, min: 0, max: 100, validate: Number.isFinite })
  esiEmployeeContributionPercentage!: number;
}
export const StatutoryDeductionsSchema =
  SchemaFactory.createForClass(StatutoryDeductions);
