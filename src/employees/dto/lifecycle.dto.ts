import {
  IsIn,
  IsString,
  Matches,
  MaxLength,
  IsOptional,
} from 'class-validator';

export const TERMINATION_REASONS = [
  'Voluntary Resignation',
  'Involuntary Termination',
  'Layoff / Reduction in Force',
  'End of Contract',
  'Retirement',
  'Job Abandonment',
  'Other',
] as const;

export class RehireEmployeeDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  rehireDate!: string;
}

export class TerminateEmployeeDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  terminationDate!: string;

  @IsIn(TERMINATION_REASONS)
  reason!: (typeof TERMINATION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(250)
  explanation?: string;
}
