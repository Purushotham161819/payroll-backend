import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request, Response } from 'express';
import { ChangePasswordDto } from './users.dto';
import { AuthService } from './auth.service';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters long.' }) @MaxLength(128) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const user = await this.auth.login(dto.email, dto.password);
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.userId = user.id;
    req.session.sessionVersion = user.sessionVersion;
    req.session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    const { sessionVersion: _version, ...identity } = user;
    return identity;
  }
  @Post('change-password')
  @HttpCode(200)
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.auth.changePassword(req.session.userId!, req.session.sessionVersion ?? 0, dto.currentPassword, dto.password);
  }
  @Get('me')
  me(@Req() req: Request) {
    return this.auth.current(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
    );
  }
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    res.clearCookie('payroll.sid', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
}
