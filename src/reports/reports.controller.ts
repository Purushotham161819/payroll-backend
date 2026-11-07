import { Controller, Get, Param, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
@Controller('reports')
export class ReportsController {
 constructor(private readonly reports:ReportsService) {}
 @Get('dashboard') dashboard(){return this.reports.dashboard();}
 @Get('workforce') workforce(@Query() query:Record<string,string>){return this.reports.workforce(query);}
 @Get('payroll-periods') periods(){return this.reports.periods();}
 @Get('payroll/:period') payroll(@Param('period') period:string,@Query() query:Record<string,string>){return this.reports.payroll(period,query);}
}
