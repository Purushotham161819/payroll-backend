import { Module } from '@nestjs/common';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { Employee,EmployeeSchema } from '../employees/schemas/employee.schema';
import { PayrollRunSchema } from '../run-payroll/schemas/payroll-run.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
@Module({imports:[BusinessModelsModule.forFeature([{name:Employee.name,schema:EmployeeSchema},{name:'PayrollRun',schema:PayrollRunSchema}])],controllers:[ReportsController],providers:[ReportsService]})
export class ReportsModule {}
