import { Module } from '@nestjs/common';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { SalaryComponentsModule } from '../salary-components/salary-components.module';
import { StatutoryDeductionsModule } from '../statutory-deductions/statutory-deductions.module';
import { PayrollCalculationModule } from '../payroll-generator/payroll-calculation.module';
import { PayrollRunSchema } from './schemas/payroll-run.schema';
import { RunPayrollService } from './run-payroll.service';
import { RunPayrollController } from './run-payroll.controller';
import { IncomeTaxModule } from '../income-tax/income-tax.module';

@Module({
  imports: [
    IncomeTaxModule,
    PayrollCalculationModule,
    SalaryComponentsModule,
    StatutoryDeductionsModule,
    BusinessModelsModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: 'PayrollRun', schema: PayrollRunSchema },
    ]),
  ],
  controllers: [RunPayrollController],
  providers: [RunPayrollService],
})
export class RunPayrollModule {}
