import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CreateUserDto } from '../auth/users.dto';
export class OnboardDto extends CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;
}
export class PageDto {
  @IsOptional() @IsIn(['admin', 'user']) role?: 'admin' | 'user';
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1000000)
  @IsOptional()
  page = 1;
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;
}
