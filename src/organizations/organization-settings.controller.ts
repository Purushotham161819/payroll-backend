import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { OrganizationAddressDto, OrganizationLogoDto } from './organization-settings.dto';

type OrganizationRequest = { account: { id: string; organizationId?: string } };

@Controller('settings/organization-profile')
export class OrganizationSettingsController {
  constructor(private readonly platform: PlatformService) {}
  @Get() get(@Req() req: OrganizationRequest) {
    return this.platform.organizationSettings(req.account.organizationId);
  }
  @Patch('logo') logo(@Req() req: OrganizationRequest, @Body() dto: OrganizationLogoDto) {
    return this.platform.saveOrganizationLogo(req.account.organizationId, req.account.id, dto.dataUrl);
  }
  @Patch('address') address(
    @Req() req: OrganizationRequest,
    @Body() dto: OrganizationAddressDto,
  ) {
    return this.platform.saveOrganizationAddress(
      req.account.organizationId,
      req.account.id,
      dto,
    );
  }
}
