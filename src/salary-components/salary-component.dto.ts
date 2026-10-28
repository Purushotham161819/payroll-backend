import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateIf,
  IsMongoId,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateSalaryComponentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name!: string;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  code!: string;
  @IsIn(['earning', 'deduction', 'allowance']) category!: 'earning' | 'deduction' | 'allowance';
  @IsIn(['annual_ctc', 'gross_wages', 'core_wages', 'salary_component']) calculationBaseType!:
    'annual_ctc' | 'gross_wages' | 'core_wages' | 'salary_component';
  @ValidateIf(
    (o) =>
      o.calculationBaseComponentId !== undefined &&
      o.calculationBaseComponentId !== null,
  )
  @IsMongoId()
  calculationBaseComponentId?: string | null;
  @IsIn(['percentage', 'fixed']) calculationType!: 'percentage' | 'fixed';
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  calculationValue!: number;
  @ValidateIf(
    (o) => o.fixedAmountPeriod !== undefined && o.fixedAmountPeriod !== null,
  )
  @IsIn(['annual', 'monthly'])
  fixedAmountPeriod?: 'annual' | 'monthly' | null;
  @ValidateIf((o) => o.showInPayslip !== undefined)
  @IsBoolean()
  showInPayslip!: boolean;
  @ValidateIf((o) => o.status !== undefined)
  @IsIn(['active', 'inactive'])
  status!: 'active' | 'inactive';
}
export class UpdateSalaryComponentDto extends PartialType(
  CreateSalaryComponentDto,
  { skipNullProperties: false },
) {}
export class SalaryComponentStatusDto {
  @IsIn(['active', 'inactive']) status!: 'active' | 'inactive';
}

