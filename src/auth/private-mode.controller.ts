import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { PrivateModeService } from './private-mode.service';
import type { PrivateRequest } from './private-mode.service';
export class PrivateModeCodeDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}
@Controller('employee-portal/private-mode')
export class PrivateModeController {
  constructor(private readonly privacy: PrivateModeService) {}
  @Get() status(@Req() req: PrivateRequest) {
    return this.privacy.status(req);
  }
  @Post('request') request(@Req() req: PrivateRequest) {
    return this.privacy.requestCode(req);
  }
  @Post('verify') verify(
    @Req() req: PrivateRequest,
    @Body() dto: PrivateModeCodeDto,
  ) {
    return this.privacy.verify(req, dto.code);
  }
  @Post('lock') lock(@Req() req: PrivateRequest) {
    return this.privacy.lock(req);
  }
}
