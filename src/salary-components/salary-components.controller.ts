import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
} from '@nestjs/common';
import {
  CreateSalaryComponentDto,
  UpdateSalaryComponentDto,
  SalaryComponentStatusDto,
} from './salary-component.dto';
import { SalaryComponentsService } from './salary-components.service';

@Controller('salary-components')
export class SalaryComponentsController {
  constructor(private readonly service: SalaryComponentsService) {}
  @Get('formula-variables') formulaVariables() {
    return this.service.formulaVariables();
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Post() create(@Body() dto: CreateSalaryComponentDto) {
    return this.service.create(dto);
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
  @Patch(':id/status') status(
    @Param('id') id: string,
    @Body() dto: SalaryComponentStatusDto,
  ) {
    return this.service.update(id, dto);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryComponentDto,
  ) {
    return this.service.update(id, dto);
  }
}
