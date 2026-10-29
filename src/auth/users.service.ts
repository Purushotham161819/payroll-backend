import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import * as argon2 from 'argon2';
import { User } from './auth.schema';
import { CreateUserDto, UserDetailsDto } from './users.dto';
import {
  initializeUserIndexes,
  publicUser,
  withAccountLock,
} from './account-storage';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  constructor(@InjectModel('AuthUser') private readonly users: Model<User>) {}
  async onModuleInit() {
    await initializeUserIndexes(this.users);
    if (await this.users.db.collection<{ _id: string }>('auth_management_locks').findOne({ _id: 'accounts' }, { projection: { _id: 1 } })) {
      this.logger.warn('User indexes are ready; startup can continue while an account-operation lock exists. Account writes remain protected. Let an active operation finish; if the lock is abandoned, use the documented operator recovery procedure after verifying all writers are stopped. No lock was removed.');
    }
  }
  async requireAdmin(id: string, version: number) {
    const actor = await this.users.findById(id).select('+sessionVersion');
    if (
      !actor?.active ||
      actor.role !== 'admin' ||
      (actor.sessionVersion ?? 0) !== version
    )
      throw new ForbiddenException('Administrator access required');
    if (actor.mustChangePassword) throw new ForbiddenException('Change your temporary password before continuing');
    if (actor.organizationId && !await this.users.db.collection('organizations').findOne({ organizationId: actor.organizationId, status: 'active' })) throw new ForbiddenException('Organization access is unavailable');
    return actor;
  }
  async list(actorId: string, version: number) {
    const actor = await this.requireAdmin(actorId, version);
    return (await this.users.find({ organizationId: actor.organizationId ?? null, role: { $in: ['admin', 'user'] } }).sort({ createdAt: 1 })).map(publicUser);
  }
  private async write<T>(
    actorId: string,
    version: number,
    work: () => Promise<T>,
  ) {
    return withAccountLock(this.users, async () => {
      await this.requireAdmin(actorId, version);
      try {
        return await work();
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw new ConflictException(
            'An account with this email already exists',
          );
        throw error;
      }
    });
  }
  private async target(id: string, actorId: string, version: number) {
    if (!isValidObjectId(id) || !/^[a-f\d]{24}$/i.test(id))
      throw new BadRequestException('Invalid user ID');
    const actor = await this.requireAdmin(actorId, version);
    const user = await this.users.findOne({ _id: id, organizationId: actor.organizationId ?? null, role: { $in: ['admin', 'user'] } }).select('+sessionVersion');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
  async create(actorId: string, version: number, dto: CreateUserDto) {
    return this.write(actorId, version, async () =>
      publicUser(
        await this.users.create({
          organizationId: (await this.requireAdmin(actorId, version)).organizationId,
          email: dto.email,
          role: dto.role,
          active: dto.active,
          passwordHash: await argon2.hash(dto.password, {
            type: argon2.argon2id,
            memoryCost: 65536,
            timeCost: 3,
          }),
        }),
      ),
    );
  }
  async details(
    actorId: string,
    version: number,
    id: string,
    dto: UserDetailsDto,
  ) {
    return this.write(actorId, version, async () => {
      const user = await this.target(id, actorId, version);
      if (actorId === user.id && dto.role !== 'admin')
        throw new ConflictException(
          'You cannot remove your own administrator access',
        );
      if (
        user.role === 'admin' &&
        dto.role !== 'admin' &&
        (await this.users.countDocuments({ role: 'admin', active: true, organizationId: user.organizationId ?? null })) <=
          1 &&
        user.active
      )
        throw new ConflictException(
          'The last active administrator must be preserved',
        );
      const changed = user.role !== dto.role || user.email !== dto.email;
      user.email = dto.email;
      user.role = dto.role;
      if (changed) user.sessionVersion = (user.sessionVersion ?? 0) + 1;
      await user.save();
      return publicUser(user);
    });
  }
  async status(actorId: string, version: number, id: string, active: boolean) {
    return this.write(actorId, version, async () => {
      const user = await this.target(id, actorId, version);
      if (!active && actorId === user.id)
        throw new ConflictException('You cannot deactivate your own account');
      if (
        !active &&
        user.active &&
        user.role === 'admin' &&
        (await this.users.countDocuments({ role: 'admin', active: true })) <= 1
      )
        throw new ConflictException(
          'The last active administrator must be preserved',
        );
      if (user.active !== active)
        user.sessionVersion = (user.sessionVersion ?? 0) + 1;
      user.active = active;
      await user.save();
      return publicUser(user);
    });
  }
  async password(
    actorId: string,
    version: number,
    id: string,
    password: string,
  ) {
    return this.write(actorId, version, async () => {
      const user = await this.target(id, actorId, version);
      user.passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
      await user.save();
      return {
        message: 'Password changed. Existing sessions have been invalidated.',
      };
    });
  }
}
