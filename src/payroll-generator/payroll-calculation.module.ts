import { Module } from '@nestjs/common';
import { SalaryCalculationService } from './salary-calculation.service';

// Controller-free calculation boundary shared by reports and payroll runs.
// It owns no workflow, persistence, authentication or tenant state.
@Module({ providers: [SalaryCalculationService], exports: [SalaryCalculationService] })
export class PayrollCalculationModule {}
