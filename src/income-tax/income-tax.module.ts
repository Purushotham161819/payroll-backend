import { Module } from '@nestjs/common';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { SalaryComponentsModule } from '../salary-components/salary-components.module';
import { StatutoryDeductionsModule } from '../statutory-deductions/statutory-deductions.module';
import { PayrollCalculationModule } from '../payroll-generator/payroll-calculation.module';
import { TaxConfigurationService } from '../tax-configuration/tax-configuration.service';
import { EmployeeTaxProfileService } from '../employee-tax-profile/employee-tax-profile.service';
import { IncomeTaxService } from './income-tax.service';
import { TaxWriteLock } from '../tax-configuration/tax-write-lock.service';
import {
  EmployeeIncomeTaxController,
  EmployeeTaxProfilesController,
  TaxAdministratorGuard,
  TaxConfigurationController,
} from './tax.controller';

@Module({
  imports: [
    PayrollCalculationModule,
    SalaryComponentsModule,
    StatutoryDeductionsModule,
    BusinessModelsModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  providers: [
    TaxWriteLock,
    TaxConfigurationService,
    EmployeeTaxProfileService,
    IncomeTaxService,
    TaxAdministratorGuard,
  ],
  controllers: [
    TaxConfigurationController,
    EmployeeIncomeTaxController,
    EmployeeTaxProfilesController,
  ],
  exports: [IncomeTaxService],
})
export class IncomeTaxModule {}
