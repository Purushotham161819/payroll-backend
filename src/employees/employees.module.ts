import { EmployeeIdentifierService } from './employee-identifier.service';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { EmployeeEmailIndexService } from './employee-email-index.service';

@Module({
  imports: [
    BusinessModelsModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [EmployeesController],
  providers: [
    EmployeeIdentifierService,
    EmployeesService,
    EmployeeEmailIndexService,
  ],
})
export class EmployeesModule {}
