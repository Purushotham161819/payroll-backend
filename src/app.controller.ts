import { Controller, Get, Req, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { Request } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Optional() @InjectConnection() private readonly connection?: Connection,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Trusted account ownership selects customer identity; legacy accounts retain
  // deployment configuration. No caller-selected organization is accepted here.
  @Get('settings/organization')
  async organization(
    @Req() req?: Request & { account?: { organizationId?: string } },
  ) {
    const id = req?.account?.organizationId;
    if (id) {
      const org = await this.connection!.collection('organizations').findOne({
        organizationId: id,
        status: 'active',
      });
      return { displayName: org?.name };
    }
    return {
      displayName:
        process.env.ORGANIZATION_NAME?.trim() ||
        'PayStream, An Excelhire Product',
    };
  }
}
