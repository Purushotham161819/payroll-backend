import { Controller, Get } from '@nestjs/common';
import { PayrollGeneratorService } from './payroll-generator.service';

@Controller('payroll')
export class PayrollGeneratorController {
  constructor(private readonly service: PayrollGeneratorService) {}

  @Get('annual')
  annual() {
    return this.service.annual();
  }
}
