import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PlatformController } from '../organizations/platform.controller';
import { OrganizationSettingsController } from '../organizations/organization-settings.controller';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    expiresAt?: number;
    sessionVersion?: number;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const login =
      context.getClass() === AuthController &&
      context.getHandler() === AuthController.prototype.login;
    const invitation =
      context.getClass() === AuthController &&
      (context.getHandler() === AuthController.prototype.inspectInvitation ||
        context.getHandler() === AuthController.prototype.completeInvitation);
    const reset =
      context.getClass() === AuthController &&
      [
        AuthController.prototype.forgotPassword,
        AuthController.prototype.inspectReset,
        AuthController.prototype.completeReset,
      ].includes(context.getHandler() as any);
    if (!login && !invitation && !reset) {
      if (
        !req.session?.userId ||
        !req.session.expiresAt ||
        req.session.expiresAt <= Date.now()
      ) {
        throw new UnauthorizedException('Authentication required');
      }
      const user = await this.auth.current(
        req.session.userId,
        req.session.sessionVersion ?? 0,
      );
      (req as Request & { account: typeof user }).account = user;
      const platform = context.getClass() === PlatformController;
      if (platform && user.role !== 'super_admin')
        throw new ForbiddenException('Super Admin access required');
      if (
        !platform &&
        context.getClass() !== AuthController &&
        user.role === 'super_admin'
      )
        throw new ForbiddenException(
          'Super Admin accounts cannot access customer business data',
        );
      if (user.mustChangePassword && context.getClass() !== AuthController)
        throw new ForbiddenException(
          'Change your temporary password before continuing',
        );
      if (
        (context.getClass() === UsersController ||
          context.getClass() === OrganizationSettingsController) &&
        user.role !== 'admin'
      )
        throw new ForbiddenException('Administrator access required');
      if (
        context.getClass() === OrganizationSettingsController &&
        !user.organizationId
      )
        throw new ForbiddenException(
          'An organization account is required to manage its address.',
        );
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // Custom-header + exact Origin verification, including login, prevents CSRF.
      if (
        req.get('Origin') !==
          (process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200') ||
        req.get('X-Payroll-Request') !== '1'
      ) {
        throw new ForbiddenException('Request origin verification failed');
      }
    }
    return true;
  }
}
