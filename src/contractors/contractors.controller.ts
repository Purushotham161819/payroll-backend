import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ContractorAccessGuard,
  ContractorAdmin,
} from './contractor-access.guard';
import { ContractorsService } from './contractors.service';
import {
  AssignmentDto,
  ContractorComponentDto,
  ContractorComponentUpdateDto,
  ContractorDto,
  ContractorPaymentDto,
  ContractorUpdateDto,
  ContractorStatusDto,
} from './contractor.dto';
type Request = { account: { id: string; organizationId: string } };
@Controller('contractors')
@UseGuards(ContractorAccessGuard)
export class ContractorsController {
  constructor(private readonly service: ContractorsService) {}
  @Get('components') components(@Req() r: Request) {
    return this.service.components(r.account.organizationId);
  }
  @Post('components') @ContractorAdmin() addComponent(
    @Req() r: Request,
    @Body() d: ContractorComponentDto,
  ) {
    return this.service.addComponent(r.account.organizationId, r.account.id, d);
  }
  @Patch('components/:id') @ContractorAdmin() updateComponent(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() d: ContractorComponentUpdateDto,
  ) {
    return this.service.updateComponent(
      r.account.organizationId,
      id,
      r.account.id,
      d,
    );
  }
  @Post('payments') pay(@Req() r: Request, @Body() d: ContractorPaymentDto) {
    return this.service.pay(r.account.organizationId, r.account.id, d);
  }
  @Get() list(@Req() r: Request) {
    return this.service.list(r.account.organizationId);
  }
  @Post() create(@Req() r: Request, @Body() d: ContractorDto) {
    return this.service.create(r.account.organizationId, r.account.id, d);
  }
  @Get(':id/payments') history(@Req() r: Request, @Param('id') id: string) {
    return this.service.history(r.account.organizationId, id);
  }
  @Patch(':id/components') assign(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() d: AssignmentDto,
  ) {
    return this.service.assign(r.account.organizationId, id, r.account.id, d);
  }
  @Patch(':id/status') @ContractorAdmin() status(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() d: ContractorStatusDto,
  ) {
    return this.service.changeStatus(r.account.organizationId, id, r.account.id, d);
  }
  @Delete(':id') @ContractorAdmin() remove(@Req() r: Request, @Param('id') id: string) {
    return this.service.remove(r.account.organizationId, id);
  }
  @Patch(':id') update(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() d: ContractorUpdateDto,
  ) {
    return this.service.update(r.account.organizationId, id, r.account.id, d);
  }
  @Get(':id') get(@Req() r: Request, @Param('id') id: string) {
    return this.service.get(r.account.organizationId, id);
  }
}
