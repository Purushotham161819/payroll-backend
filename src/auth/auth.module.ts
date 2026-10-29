import { PlatformController } from '../organizations/platform.controller';
import { PlatformService } from '../organizations/platform.service';
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
  controllers: [AuthController, UsersController, PlatformController],
  providers: [
    PlatformService,
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    AuthService,
    UsersService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
