import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TaxConfigurationService } from '../tax-configuration/tax-configuration.service';
import { EmployeeTaxProfileService } from '../employee-tax-profile/employee-tax-profile.service';
import { IncomeTaxService } from './income-tax.service';

@Injectable()
export class TaxAdministratorGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest().account?.role !== 'admin')
      throw new ForbiddenException(
        'Administrator access required for employee tax information.',
      );
    return true;
  }
}
type ActorRequest = { account: { id: string } };
@Controller('settings/tax-configuration')
@UseGuards(TaxAdministratorGuard)
export class TaxConfigurationController {
  constructor(private readonly configuration: TaxConfigurationService) {}
  @Get() get() {
    return this.configuration.get();
  }
  @Put('years') year(@Body() body: any, @Req() req: ActorRequest) {
    return this.configuration.saveYear(body, req.account.id);
  }
  @Post('years/:code/status') status(
    @Param('code') code: string,
    @Body() body: any,
    @Req() req: ActorRequest,
  ) {
    return this.configuration.activateYear(code, body, req.account.id);
  }
  @Post('revisions') revision(@Body() body: any, @Req() req: ActorRequest) {
    return this.configuration.saveRevision(body, req.account.id);
  }
  @Post('revisions/:id/activate') activate(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: ActorRequest,
  ) {
    return this.configuration.publish(id, body, req.account.id);
  }
}
@Controller('employees/:id/income-tax/:year')
@UseGuards(TaxAdministratorGuard)
export class EmployeeIncomeTaxController {
  constructor(
    private readonly profiles: EmployeeTaxProfileService,
    private readonly tax: IncomeTaxService,
  ) {}
  @Get() summary(@Param('id') id: string, @Param('year') year: string) {
    return this.tax.summary(id, year);
  }
  @Put() profile(
    @Param('id') id: string,
    @Param('year') year: string,
    @Body() body: any,
    @Req() req: ActorRequest,
  ) {
    return this.profiles.saveFromEditor(id, year, body, req.account.id);
  }
  @Post('edit') edit(
    @Param('id') id: string,
    @Param('year') year: string,
    @Body() body: any,
    @Req() req: ActorRequest,
  ) {
    return this.profiles.beginEdit(id, year, body?.version, req.account.id);
  }
  @Post('change-year') changeYear(
    @Param('id') id: string,
    @Param('year') year: string,
    @Body() body: any,
    @Req() req: ActorRequest,
  ) {
    return this.profiles.changeYear(id, year, body, req.account.id);
  }
  @Post('calculate') calculate(
    @Param('id') id: string,
    @Param('year') year: string,
    @Req() req: ActorRequest,
  ) {
    return this.tax.project(id, year, req.account.id);
  }
  @Get('history') history(
    @Param('id') id: string,
    @Param('year') year: string,
  ) {
    return this.tax.history(id, year);
  }
}

@Controller('employees/:id/income-tax')
@UseGuards(TaxAdministratorGuard)
export class EmployeeTaxProfilesController {
  constructor(private readonly profiles: EmployeeTaxProfileService) {}
  @Get() list(@Param('id') id: string) {
    return this.profiles.list(id);
  }
}
