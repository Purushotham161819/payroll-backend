import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EmployeeAccountsService } from './employee-accounts.service';
import { UserStatusDto } from './users.dto';
import { IsMongoId, ValidateIf } from 'class-validator';

export class EmployeeInvitationDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsMongoId()
  linkPendingUserId?: string;
}

@Controller('employee-accounts')
export class EmployeeAccountsController {
  constructor(private readonly accounts: EmployeeAccountsService) {}
  @Get(':id/permissions') permissions(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.accounts.permissions(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
    );
  }
  @Post(':id/invitation/cancel') cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.accounts.cancelInvitation(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
    );
  }
  @Post(':id/invitation/resend') resend(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.accounts.resendInvitation(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
    );
  }
  @Post(':id/invitation') invite(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: EmployeeInvitationDto,
  ) {
    return this.accounts.invite(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
      dto.linkPendingUserId,
    );
  }
  @Patch(':id/status') status(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UserStatusDto,
  ) {
    return this.accounts.status(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
      id,
      dto.active,
    );
  }
}

@Controller('employee-portal')
export class EmployeePortalController {
  constructor(private readonly accounts: EmployeeAccountsService) {}
  @Get('profile') profile(@Req() req: Request) {
    return this.accounts.profile(
      req.session.userId!,
      req.session.sessionVersion ?? 0,
    );
  }
}
