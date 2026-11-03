import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const canonicalId = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
export class ContractorDto {
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(80) firstName!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(80) lastName!: string;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class ContractorUpdateDto extends ContractorDto {
  @IsInt() @Min(0) version!: number;
}
export class ContractorStatusDto {
  @IsInt() @Min(0) version!: number;
  @IsIn(['Active', 'Inactive']) status!: 'Active' | 'Inactive';
}
export class AssignmentDto {
  @IsInt() @Min(0) version!: number;
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map(canonicalId) : value,
  )
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  componentIds!: string[];
}
export class ContractorComponentDto {
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,39}$/)
  code!: string;
  @IsIn(['deduction']) classification!: 'deduction';
  @IsIn(['active', 'inactive']) status!: 'active' | 'inactive';
  @IsIn(['fixed', 'percentage', 'formula']) calculationType!:
    'fixed' | 'percentage' | 'formula';
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1e9)
  calculationValue?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1024) formula?: string;
}
export class ContractorComponentUpdateDto extends ContractorComponentDto {
  @IsInt() @Min(0) version!: number;
}
export class ContractorPaymentLineDto {
  @Transform(({ value }) => canonicalId(value))
  @IsMongoId()
  componentId!: string;
  @IsInt() @Min(0) componentVersion!: number;
}
export class ContractorPaymentEntryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  description?: string;
  @Transform(({ value }) => canonicalId(value))
  @IsMongoId()
  contractorId!: string;
  @IsInt() @Min(0) contractorVersion!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1e9)
  grossPay!: number;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ContractorPaymentLineDto)
  components!: ContractorPaymentLineDto[];
}
export class ContractorPaymentDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) paymentDate!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  description?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractorPaymentEntryDto)
  entries!: ContractorPaymentEntryDto[];
}
