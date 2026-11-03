import { Module } from '@nestjs/common';
import { ContractorsController } from './contractors.controller';
import { ContractorsService } from './contractors.service';
import { ContractorAccessGuard } from './contractor-access.guard';
@Module({
  controllers: [ContractorsController],
  providers: [ContractorsService, ContractorAccessGuard],
})
export class ContractorsModule {}
