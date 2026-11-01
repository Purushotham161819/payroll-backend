import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

// Optional profile metadata: missing values do not backfill legacy records.
export class EmployeeProfileFieldsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(40)
  @Matches(
    /^(?:(?=.*[0-9])\+?[0-9(][0-9 ().-]*(?: *(?:x|ext\.?|#) *[0-9]+)?)?$/i,
    {
      message:
        'contactNumber must be a phone number with optional country code and extension',
    },
  )
  contactNumber?: string;


  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  designation?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(250)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  addressLine1?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(250)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  addressLine2?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  city?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  state?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(32)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  zipCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  country?: string;
}
