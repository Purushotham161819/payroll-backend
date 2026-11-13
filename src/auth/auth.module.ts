import { EmailService } from './email.service';
import { PrivateModeService } from './private-mode.service';
import { PrivateModeController } from './private-mode.controller';
import { PrivateModeInterceptor } from './private-mode.interceptor';
import { EmployeeAccountsService } from './employee-accounts.service';
import { EmployeeAccountsController, EmployeePortalController } from './employee-accounts.controller';
import { PasswordResetService } from './password-reset.service';
import { InvitationsService } from './invitations.service';
import { InvitationMail } from './invitation-mail';
import { PlatformController } from '../organizations/platform.controller';
import { PlatformService } from '../organizations/platform.service';
import { OrganizationSettingsController } from '../organizations/organization-settings.controller';
import { TenantInterceptor } from '../organizations/tenant.interceptor';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { UserSchema } from './auth.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'AuthUser', schema: UserSchema }]),
  ],
  controllers: [
    PrivateModeController,
    EmployeeAccountsController, EmployeePortalController,
    AuthController,
    UsersController,
    PlatformController,
    OrganizationSettingsController,
  ],
  providers: [
    PrivateModeService,
    { provide: APP_INTERCEPTOR, useClass: PrivateModeInterceptor },
    EmployeeAccountsService,
    PlatformService,
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    AuthService,
    UsersService,
    InvitationsService,
    InvitationMail,
    EmailService,
    PasswordResetService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PrivateModeService],
})
export class AuthModule {}
