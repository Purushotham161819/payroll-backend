import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { withAccountLock } from './account-storage';
import { hashPassword } from './password-hashing';
import { User } from './auth.schema';

@Injectable()
export class AuthService {
  // Equalize password verification work for nonexistent accounts.
  private readonly dummy = argon2.hash(randomBytes(32), {
    type: argon2.argon2id,
  });
  constructor(@InjectModel('AuthUser') private readonly users: Model<User>) {}
  async login(email: string, password: string) {
    const user = await this.users
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash +sessionVersion');
    const valid = await argon2.verify(
      user?.passwordHash ?? (await this.dummy),
      password,
    );
    if (!valid || !user?.active)
      throw new UnauthorizedException('Invalid email or password');
    await this.organizationActive(user);
    return {
      ...this.identity(user),
      id: user.id,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion ?? 0,
    };
  }
  async current(id: string, version = 0) {
    const user = await this.users.findById(id).select('+sessionVersion');
    if (!user?.active || (user.sessionVersion ?? 0) !== version)
      throw new UnauthorizedException('Authentication required');
    await this.organizationActive(user);
    return this.identity(user);
  }
  private identity(user: User & { id: string }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      ...(user.organizationId ? { organizationId: user.organizationId } : {}),
      ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
    };
  }
  private async organizationActive(user: User) {
    if (
      user.organizationId &&
      !(await this.users.db
        .collection('organizations')
        .findOne({ organizationId: user.organizationId, status: 'active' }))
    )
      throw new UnauthorizedException(
        'Organization access is unavailable. Contact your administrator.',
      );
  }
  async changePassword(
    id: string,
    version: number,
    currentPassword: string,
    password: string,
  ) {
    return withAccountLock(this.users, async () => {
      await this.current(id, version);
      const user = await this.users
        .findById(id)
        .select('+passwordHash +sessionVersion');
      if (!user || !(await argon2.verify(user.passwordHash, currentPassword)))
        throw new BadRequestException('Current password is incorrect');
      if (await argon2.verify(user.passwordHash, password))
        throw new BadRequestException('Choose a different password');
      user.passwordHash = await hashPassword(password);
      user.mustChangePassword = false;
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
      await user.save();
      return {
        message: 'Password changed. Sign in again with your new password.',
      };
    });
  }
}
