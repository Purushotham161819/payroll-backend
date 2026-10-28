import { Body, Controller, Get, Put } from '@nestjs/common';
import { StatutoryDeductionsService } from './statutory-deductions.service';
import { StatutoryDeductionsDto } from './statutory-deductions.dto';

@Controller('settings/statutory-deductions')
export class StatutoryDeductionsController {
  constructor(private readonly service: StatutoryDeductionsService) {}
  @Get() get() { return this.service.get(); }
  @Put() save(@Body() dto: StatutoryDeductionsDto) { return this.service.save(dto); }
}
