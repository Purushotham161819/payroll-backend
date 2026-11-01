import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class OrganizationAddressDto {
  @IsInt() @Min(0) version: number;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  addressLine1: string;

  @Transform(trimmed)
  @IsString()
  @MaxLength(250)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  addressLine2 = '';

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  city: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  state: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  country: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[^\u0000-\u001f\u007f]*$/u)
  zipCode: string;
}
