import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Deployment-level customer identity; protected by the existing global guard.
  // Configuration is operator-managed, with no user-accessible write endpoint.
  @Get('settings/organization')
  organization() {
    return { displayName: process.env.ORGANIZATION_NAME?.trim() || 'PayStream, An Excelhire Product' };
  }
}
