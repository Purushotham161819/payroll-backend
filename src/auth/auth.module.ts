import { EmailService } from './email.service';
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
    AuthController,
    UsersController,
    PlatformController,
    OrganizationSettingsController,
  ],
  providers: [
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
})
export class AuthModule {}
