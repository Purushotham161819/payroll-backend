import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  InviteUserDto,
  PasswordDto,
  UserDetailsDto,
  UserStatusDto,
} from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() list(@Req() req: Request) {
    return this.users.list(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
    );
  }
  @Post() create(@Req() req: Request, @Body() dto: InviteUserDto) {
    return this.users.create(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      dto,
    );
  }
  @Post(':id/invitation') resend(@Req() req: Request, @Param('id') id: string) {
    return this.users.resend(req.session.userId!, req.session.sessionVersion ?? 0, id);
  }
  @Patch(':id') details(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UserDetailsDto,
  ) {
    return this.users.details(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
      dto,
    );
  }
  @Patch(':id/status') status(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UserStatusDto,
  ) {
    return this.users.status(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
      dto.active,
    );
  }
  @Patch(':id/password') password(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PasswordDto,
  ) {
    return this.users.password(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
      dto.password,
    );
  }
}
