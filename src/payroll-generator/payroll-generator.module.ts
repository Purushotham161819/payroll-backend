import { Module } from '@nestjs/common';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { SalaryComponentsModule } from '../salary-components/salary-components.module';
import { StatutoryDeductionsModule } from '../statutory-deductions/statutory-deductions.module';
import { PayrollGeneratorController } from './payroll-generator.controller';
import { PayrollGeneratorService } from './payroll-generator.service';
import { PayrollCalculationModule } from './payroll-calculation.module';

@Module({
  imports: [
    PayrollCalculationModule,
    SalaryComponentsModule,
    StatutoryDeductionsModule,
    BusinessModelsModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [PayrollGeneratorController],
  providers: [PayrollGeneratorService],
})
export class PayrollGeneratorModule {}
