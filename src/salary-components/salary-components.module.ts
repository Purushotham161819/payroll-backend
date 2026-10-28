import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalaryComponent, SalaryComponentSchema } from './salary-component.schema';
import { SalaryComponentsController } from './salary-components.controller';
import { SalaryComponentsService } from './salary-components.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: SalaryComponent.name, schema: SalaryComponentSchema }])],
  controllers: [SalaryComponentsController],
  providers: [SalaryComponentsService],
  exports: [SalaryComponentsService],
})
export class SalaryComponentsModule {}

