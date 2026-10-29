import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UserDetailsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
  @IsIn(['admin', 'user']) role: 'admin' | 'user';
}
export class CreateUserDto extends UserDetailsDto {
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters long.' }) @MaxLength(128) password: string;
  @IsBoolean() active: boolean;
}
export class PasswordDto {
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters long.' }) @MaxLength(128) password: string;
}
export class UserStatusDto {
  @IsBoolean() active: boolean;
}
