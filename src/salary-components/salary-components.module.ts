import { PayrollController } from './payroll.controller';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { StatutoryDeductionsModule } from '../statutory-deductions/statutory-deductions.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalaryComponent, SalaryComponentSchema } from './salary-component.schema';
import { SalaryComponentsController } from './salary-components.controller';
import { SalaryComponentsService } from './salary-components.service';
import { SalaryCalculationService } from './salary-calculation.service';

@Module({
  imports: [StatutoryDeductionsModule, MongooseModule.forFeature([{ name: Employee.name, schema: EmployeeSchema },{ name: SalaryComponent.name, schema: SalaryComponentSchema }])],
  controllers: [SalaryComponentsController, PayrollController],
  providers: [SalaryComponentsService, SalaryCalculationService],
  exports: [SalaryCalculationService],
})
export class SalaryComponentsModule {}

