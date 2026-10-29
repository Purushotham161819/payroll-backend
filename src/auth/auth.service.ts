import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
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
    return {
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
    return { id: user.id, email: user.email, role: user.role };
  }
}
