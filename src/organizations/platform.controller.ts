import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from './platform.service';
import { OnboardDto, PageDto } from './platform.dto';
import {
  CreateUserDto,
  PasswordDto,
  UserDetailsDto,
  UserStatusDto,
} from '../auth/users.dto';
@Controller('super-admin')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}
  @Get('dashboard') dashboard(@Req() r: Request) {
    return this.service.dashboard(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
    );
  }
  @Get('organizations') list(@Req() r: Request, @Query() q: PageDto) {
    return this.service.list(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      q,
    );
  }
  @Post('organizations') create(@Req() r: Request, @Body() dto: OnboardDto) {
    return this.service.onboard(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      dto,
    );
  }
  @Get('organizations/:org') details(
    @Req() r: Request,
    @Param('org') org: string,
  ) {
    return this.service.details(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
    );
  }
  @Patch('organizations/:org/status') status(
    @Req() r: Request,
    @Param('org') org: string,
    @Body() dto: UserStatusDto,
  ) {
    return this.service.status(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      dto.active,
    );
  }
  @Get('organizations/:org/accounts') accounts(
    @Req() r: Request,
    @Param('org') org: string,
    @Query() q: PageDto,
  ) {
    return this.service.accounts(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      q,
    );
  }
  @Post('organizations/:org/accounts') account(
    @Req() r: Request,
    @Param('org') org: string,
    @Body() dto: CreateUserDto,
  ) {
    return this.service.createAccount(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      dto,
    );
  }
  @Patch('organizations/:org/accounts/:id') edit(
    @Req() r: Request,
    @Param('org') org: string,
    @Param('id') id: string,
    @Body() dto: UserDetailsDto,
  ) {
    return this.service.updateAccount(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      id,
      { details: dto },
    );
  }
  @Patch('organizations/:org/accounts/:id/status') activate(
    @Req() r: Request,
    @Param('org') org: string,
    @Param('id') id: string,
    @Body() dto: UserStatusDto,
  ) {
    return this.service.updateAccount(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      id,
      { active: dto.active },
    );
  }
  @Patch('organizations/:org/accounts/:id/password') password(
    @Req() r: Request,
    @Param('org') org: string,
    @Param('id') id: string,
    @Body() dto: PasswordDto,
  ) {
    return this.service.updateAccount(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      id,
      { password: dto.password },
    );
  }
  @Get('organizations/:org/audit') audit(
    @Req() r: Request,
    @Param('org') org: string,
    @Query() q: PageDto,
  ) {
    return this.service.events(
      r.session.userId!,
      r.session.sessionVersion ?? 0,
      org,
      q,
    );
  }
}
