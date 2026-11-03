import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
export const ContractorAdmin = () => SetMetadata('contractorAdmin', true);
@Injectable()
export class ContractorAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest().account;
    if (
      !user ||
      !['admin', 'user'].includes(user.role) ||
      !/^ORG\d{6,}$/.test(user.organizationId || '')
    )
      throw new ForbiddenException(
        'An organization account is required for Contractor Management.',
      );
    if (
      this.reflector.get<boolean>('contractorAdmin', context.getHandler()) &&
      user.role !== 'admin'
    )
      throw new ForbiddenException('Administrator access required.');
    return true;
  }
}
