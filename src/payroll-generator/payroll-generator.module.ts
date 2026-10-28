import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { SalaryComponentsModule } from '../salary-components/salary-components.module';
import { StatutoryDeductionsModule } from '../statutory-deductions/statutory-deductions.module';
import { PayrollGeneratorController } from './payroll-generator.controller';
import { PayrollGeneratorService } from './payroll-generator.service';
import { SalaryCalculationService } from './salary-calculation.service';

@Module({
  imports: [
    SalaryComponentsModule,
    StatutoryDeductionsModule,
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [PayrollGeneratorController],
  providers: [PayrollGeneratorService, SalaryCalculationService],
})
export class PayrollGeneratorModule {}
