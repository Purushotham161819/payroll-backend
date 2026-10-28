import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { EmployeesModule } from "./employees/employees.module";
import { MongooseModule } from "@nestjs/mongoose";
import { SalaryComponentsModule } from './salary-components/salary-components.module';
import { StatutoryDeductionsModule } from './statutory-deductions/statutory-deductions.module';

@Module({
  imports: [
    MongooseModule.forRoot(
      process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/payroll_db",
      { serverSelectionTimeoutMS: 5000, retryAttempts: 2, retryDelay: 1000 },
    ),
    EmployeesModule,
    SalaryComponentsModule,
    StatutoryDeductionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
