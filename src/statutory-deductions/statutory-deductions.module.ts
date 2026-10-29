import { Module } from '@nestjs/common';
import { BusinessModelsModule } from '../organizations/business-models.module';
import {
  StatutoryDeductions,
  StatutoryDeductionsSchema,
} from './statutory-deductions.schema';
import { StatutoryDeductionsController } from './statutory-deductions.controller';
import { StatutoryDeductionsService } from './statutory-deductions.service';
import { StatutoryContributionService } from './statutory-contribution.service';

@Module({
  imports: [
    BusinessModelsModule.forFeature([
      { name: StatutoryDeductions.name, schema: StatutoryDeductionsSchema },
    ]),
  ],
  controllers: [StatutoryDeductionsController],
  providers: [StatutoryDeductionsService, StatutoryContributionService],
  exports: [StatutoryDeductionsService, StatutoryContributionService],
})
export class StatutoryDeductionsModule {}
