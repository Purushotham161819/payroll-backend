import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  Matches,
  IsEmail,
} from 'class-validator';
import { Transform } from 'class-transformer';


export class CreateEmployeeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'firstName must contain a non-whitespace character' })
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'lastName must contain a non-whitespace character' })
  lastName!: string;

  @IsDateString({ strict: true })
  dateOfBirth!: string;

  @IsDateString({ strict: true })
  hireDate!: string;

  @IsNumber()
  @Min(0)
  annualCtc!: number;
}

