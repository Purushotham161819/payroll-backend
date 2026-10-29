import { StatutoryDeductionsModule } from '../statutory-deductions/statutory-deductions.module';
import { Module } from '@nestjs/common';
import { BusinessModelsModule } from '../organizations/business-models.module';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from './salary-component.schema';
import { SalaryComponentsController } from './salary-components.controller';
import { SalaryComponentsService } from './salary-components.service';

@Module({
  imports: [
    StatutoryDeductionsModule,
    BusinessModelsModule.forFeature([
      { name: SalaryComponent.name, schema: SalaryComponentSchema },
    ]),
  ],
  controllers: [SalaryComponentsController],
  providers: [SalaryComponentsService],
  exports: [SalaryComponentsService],
})
export class SalaryComponentsModule {}
