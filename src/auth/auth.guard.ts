import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
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
    if (!login) {
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
      if (context.getClass() === UsersController && user.role !== 'admin')
        throw new ForbiddenException('Administrator access required');
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
