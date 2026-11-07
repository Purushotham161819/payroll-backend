import { Transform } from 'class-transformer';
import {
  IsBoolean,
  ValidateIf,
  Matches,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimName = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class UserDetailsDto {
  @ValidateIf((_object, value) => value !== undefined) @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) firstName?: string;
  @ValidateIf((_object, value) => value !== undefined) @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) lastName?: string;
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

export class ChangePasswordDto extends PasswordDto {
  @IsString() @MinLength(8) @MaxLength(128) currentPassword: string;
}

// Separate from legacy platform provisioning, which retains its existing password workflow.
export class InviteUserDto {
  @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) lastName: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email: string;
  @IsIn(['admin', 'user']) role: 'admin' | 'user';
  @IsBoolean() active: boolean;
}
export class InvitationTokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token: string;
}
export class SetInvitationPasswordDto extends InvitationTokenDto {
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsString() @MinLength(8) @MaxLength(128) confirmation: string;
}
