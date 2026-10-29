import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { PayrollGeneratorService } from './payroll-generator.service';

@Controller('payroll')
export class PayrollGeneratorController {
  constructor(private readonly service: PayrollGeneratorService) {}

  @Get('annual')
  annual(@Query('includeTerminated') includeTerminated?: string) {
    if (
      includeTerminated !== undefined &&
      !['true', 'false'].includes(includeTerminated)
    )
      throw new BadRequestException('includeTerminated must be true or false.');
    return this.service.annual(undefined, includeTerminated === 'true');
  }

  @Post('annual')
  selectedAnnual(
    @Body()
    body: {
      selectedComponentIds?: unknown;
      includeTerminated?: unknown;
    },
  ) {
    if (
      body?.includeTerminated !== undefined &&
      typeof body.includeTerminated !== 'boolean'
    )
      throw new BadRequestException('includeTerminated must be a boolean.');
    return this.service.annual(
      body?.selectedComponentIds,
      body?.includeTerminated === true,
    );
  }
}
