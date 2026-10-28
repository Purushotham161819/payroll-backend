import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StatutoryDeductions, StatutoryDeductionsSchema } from './statutory-deductions.schema';
import { StatutoryDeductionsController } from './statutory-deductions.controller';
import { StatutoryDeductionsService } from './statutory-deductions.service';
import { StatutoryContributionService } from './statutory-contribution.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: StatutoryDeductions.name, schema: StatutoryDeductionsSchema }])],
  controllers: [StatutoryDeductionsController],
  providers: [StatutoryDeductionsService, StatutoryContributionService],
  exports: [StatutoryDeductionsService, StatutoryContributionService],
})
export class StatutoryDeductionsModule {}
