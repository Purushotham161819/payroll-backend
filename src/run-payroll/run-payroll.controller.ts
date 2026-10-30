import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RunPayrollService } from './run-payroll.service';
import type { RunRequest, SubmitPayrollRequest } from './run-payroll.dto';

type AccountRequest = Request & { account: { id: string; email: string } };
@Controller('payroll')
export class RunPayrollController {
  constructor(private readonly service: RunPayrollService) {}
  private actor(req: AccountRequest) {
    return req.account.id;
  }
  @Post('runs/preview') preview(@Body() body: RunRequest) {
    return this.service.preview(body);
  }
  @Post('runs/draft') save(
    @Body() body: RunRequest,
    @Req() req: AccountRequest,
  ) {
    return this.service.save(body, this.actor(req));
  }
  @Post('runs/:period/submit') submit(
    @Param('period') period: string,
    @Body()
    body: SubmitPayrollRequest,
    @Req() req: AccountRequest,
  ) {
    return this.service.submit(period, body, this.actor(req));
  }
  @Get('runs/:period') submission(
    @Param('period') period: string,
    @Query('submissionId') submissionId?: string,
  ) {
    return this.service.submission(period, submissionId);
  }
  @Get('employees/:id/checks') history(@Param('id') id: string) {
    return this.service.history(id);
  }
  @Get('runs/:period/checks/:id/pdf') async pdf(
    @Param('period') period: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.service.pdf(period, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Payslip_${period}_${id}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(pdf);
  }
}
