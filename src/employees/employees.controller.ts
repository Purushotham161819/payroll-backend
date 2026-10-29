import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { RehireEmployeeDto, TerminateEmployeeDto } from './dto/lifecycle.dto';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  findAll() {
    return this.employeesService.findAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }

  @Patch(':id/terminate')
  terminate(@Param('id') id: string, @Body() dto: TerminateEmployeeDto) {
    return this.employeesService.terminate(id, dto);
  }

  @Patch(':id/rehire')
  rehire(@Param('id') id: string, @Body() dto: RehireEmployeeDto) {
    return this.employeesService.rehire(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(id, dto);
  }
}
