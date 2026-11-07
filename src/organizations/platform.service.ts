import { validateLogo } from './organization-logo';
import { EmailService } from '../auth/email.service';
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { hashPassword } from '../auth/password-hashing';
import { User } from '../auth/auth.schema';
import { withAccountLock, publicUser } from '../auth/account-storage';
import { CreateUserDto, UserDetailsDto } from '../auth/users.dto';
import { OnboardDto, PageDto } from './platform.dto';
import { OrganizationAddressDto } from './organization-settings.dto';

@Injectable()
export class PlatformService implements OnModuleInit {
  constructor(
    @InjectModel('AuthUser') private readonly users: Model<User>,
    private readonly mail: EmailService,
  ) {}
  private get organizations() {
    return this.users.db.collection('organizations');
  }
  private get audits() {
    return this.users.db.collection('platform_audit_events');
  }
  async onModuleInit() {
    await this.organizations.createIndex(
      { organizationId: 1 },
      { unique: true },
    );
    await this.organizations.createIndex(
      { normalizedName: 1 },
      { unique: true },
    );
    await this.audits.createIndex({ organizationId: 1, at: -1 });
  }
  private async actor(id: string, version: number) {
    const user = await this.users.findById(id).select('+sessionVersion');
    if (
      !user?.active ||
      user.role !== 'super_admin' ||
      (user.sessionVersion ?? 0) !== version
    )
      throw new ForbiddenException('Super Admin access required');
  }
  private audit(
    actorId: string,
    action: string,
    organizationId: string,
    accountId?: string,
  ) {
    return this.audits.insertOne({
      actorId,
      action,
      organizationId,
      ...(accountId ? { accountId } : {}),
      at: new Date(),
    });
  }
  private async write<T>(
    actor: string,
    version: number,
    work: () => Promise<T>,
  ) {
    return withAccountLock(this.users, async () => {
      await this.actor(actor, version);
      try {
        return await work();
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw new ConflictException(
            'Organization name or account email already exists',
          );
        throw error;
      }
    });
  }
  async dashboard(actor: string, version: number) {
    await this.actor(actor, version);
    const [organizations, activeOrganizations, admins, users] =
      await Promise.all([
        this.organizations.countDocuments({}),
        this.organizations.countDocuments({ status: 'active' }),
        this.users.countDocuments({
          role: 'admin',
          organizationId: { $exists: true },
        }),
        this.users.countDocuments({
          role: 'user',
          organizationId: { $exists: true },
        }),
      ]);
    return { organizations, activeOrganizations, admins, users };
  }
  async list(actor: string, version: number, page: PageDto) {
    await this.actor(actor, version);
    const [items, total] = await Promise.all([
      this.organizations
        .find({}, { projection: { normalizedName: 0 } })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page.page - 1) * page.limit)
        .limit(page.limit)
        .toArray(),
      this.organizations.countDocuments({}),
    ]);
    return {
      items: await Promise.all(
        items.map(async (item) => ({
          ...item,
          admins: await this.users.countDocuments({
            organizationId: item.organizationId,
            role: 'admin',
          }),
          users: await this.users.countDocuments({
            organizationId: item.organizationId,
            role: 'user',
          }),
        })),
      ),
      total,
      page: page.page,
      limit: page.limit,
    };
  }
  async organization(id: string) {
    const organization = await this.organizations.findOne(
      { organizationId: id },
      { projection: { normalizedName: 0 } },
    );
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }
  async details(actor: string, version: number, id: string) {
    await this.actor(actor, version);
    return this.organization(id);
  }
  async organizationSettings(id?: string) {
    if (!id)
      throw new ForbiddenException(
        'An organization account is required to manage its address.',
      );
    const organization = await this.organization(id);
    if (organization.status !== 'active')
      throw new ForbiddenException('Organization is not active.');
    return {
      logo: organization.logo ?? null,
      organizationName: organization.name,
      addressVersion: organization.addressVersion ?? 0,
      address: Object.fromEntries(
        [
          'addressLine1',
          'addressLine2',
          'city',
          'state',
          'country',
          'zipCode',
        ].map((key) => [key, organization.address?.[key] ?? '']),
      ),
    };
  }
  async saveOrganizationLogo(id: string | undefined, actor: string, dataUrl: string) {
    const user = await this.users.findById(actor);
    if (!id || !user?.active || user.role !== 'admin' || user.organizationId !== id) throw new ForbiddenException('Administrator access required');
    await this.organizationSettings(id);
    const logo = dataUrl ? validateLogo(dataUrl) : null;
    const result = await this.organizations.updateOne({ organizationId: id, status: 'active' }, { $set: { logo, logoUpdatedAt: new Date(), logoUpdatedBy: actor } });
    if (!result.matchedCount) throw new ConflictException('Organization is unavailable.');
    return this.organizationSettings(id);
  }
  async saveOrganizationAddress(
    id: string | undefined,
    actor: string,
    dto: OrganizationAddressDto,
  ) {
    await this.organizationSettings(id);
    const address = Object.fromEntries(
      [
        'addressLine1',
        'addressLine2',
        'city',
        'state',
        'country',
        'zipCode',
      ].map((key) => [key, dto[key as keyof OrganizationAddressDto]]),
    );
    const result = await this.organizations.updateOne(
      {
        organizationId: id,
        status: 'active',
        ...(dto.version === 0
          ? {
              $or: [
                { addressVersion: 0 },
                { addressVersion: { $exists: false } },
              ],
            }
          : { addressVersion: dto.version }),
      },
      {
        $set: {
          address,
          addressUpdatedAt: new Date(),
          addressUpdatedBy: actor,
        },
        $inc: { addressVersion: 1 },
      },
    );
    if (!result.matchedCount)
      throw new ConflictException(
        'Organization address changed. Reload before editing again.',
      );
    return this.organizationSettings(id);
  }
  async onboard(actor: string, version: number, dto: OnboardDto) {
    return this.write(actor, version, async () => {
      // A durable pending record is fail-closed even if the process dies between
      // writes on standalone MongoDB. Only active organizations can sign in.
      const counter = await this.users.db
        .collection<{ _id: string; value: number }>('platform_counters')
        .findOneAndUpdate(
          { _id: 'organizations' },
          { $inc: { value: 1 } },
          { upsert: true, returnDocument: 'after' },
        );
      if (!Number.isSafeInteger(counter?.value))
        throw new ConflictException('Organization identifier exhausted');
      const organizationId = 'ORG' + String(counter!.value).padStart(6, '0');
      const _id = new Types.ObjectId();
      const accountId = new Types.ObjectId();
      try {
        await this.organizations.insertOne({
          _id,
          organizationId,
          name: dto.name,
          normalizedName: dto.name.toLowerCase(),
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const account = await this.users.create({
          _id: accountId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          role: 'admin',
          active: true,
          organizationId,
          mustChangePassword: true,
          passwordHash: await hashPassword(dto.password),
        });
        await this.audit(actor, 'organization.created', organizationId);
        await this.audit(
          actor,
          'account.admin.created',
          organizationId,
          account.id,
        );
        await this.organizations.updateOne(
          { _id, status: 'pending' },
          { $set: { status: 'active', updatedAt: new Date() } },
        );
        return {
          organizationId,
          name: dto.name,
          message:
            'Customer created. Deliver the temporary password privately. The administrator must change it at first sign-in.',
        };
      } catch (error) {
        // A lost acknowledgement may mean activation actually committed. Never
        // remove its administrator after the organization became usable. If this
        // verification itself fails, leave ownership intact for operator review.
        const persisted = await this.organizations.findOne({ _id });
        if (persisted?.status === 'active') {
          return {
            organizationId,
            name: dto.name,
            message:
              'Customer created. Password change required at first sign-in.',
          };
        }
        // Delete only records owned by this failed operation; never touch other accounts.
        await this.users.deleteOne({ _id: accountId, organizationId });
        await this.organizations.deleteOne({ _id, status: 'pending' });
        throw error;
      }
    });
  }
  async status(actor: string, version: number, id: string, active: boolean) {
    return this.write(actor, version, async () => {
      const organization = await this.organization(id);
      if (organization.status === 'pending')
        throw new ConflictException(
          'Incomplete onboarding requires operator review',
        );
      // Invalidate sessions before status changes, including a later reactivation.
      await this.audit(
        actor,
        active
          ? 'organization.activation.requested'
          : 'organization.deactivation.requested',
        id,
      );
      await this.users.updateMany(
        { organizationId: id },
        { $inc: { sessionVersion: 1 } },
      );
      await this.organizations.updateOne(
        { organizationId: id },
        {
          $set: {
            status: active ? 'active' : 'inactive',
            updatedAt: new Date(),
          },
        },
      );
      await this.audit(
        actor,
        active ? 'organization.activated' : 'organization.deactivated',
        id,
      );
      return this.organization(id);
    });
  }
  async accounts(actor: string, version: number, id: string, page: PageDto) {
    await this.actor(actor, version);
    await this.organization(id);
    const filter = {
      organizationId: id,
      role: page.role ?? { $in: ['admin', 'user'] },
    };
    return {
      items: (
        await this.users
          .find(filter)
          .sort({ createdAt: 1, _id: 1 })
          .skip((page.page - 1) * page.limit)
          .limit(page.limit)
      ).map(publicUser),
      total: await this.users.countDocuments(filter),
      page: page.page,
      limit: page.limit,
    };
  }
  async createAccount(
    actor: string,
    version: number,
    id: string,
    dto: CreateUserDto,
  ) {
    return this.write(actor, version, async () => {
      const organization = await this.organization(id);
      if (organization.status !== 'active')
        throw new ConflictException(
          'Activate the organization before creating accounts',
        );
      const accountId = new Types.ObjectId();
      await this.audit(
        actor,
        'account.creation.requested',
        id,
        String(accountId),
      );
      const user = await this.users.create({
        _id: accountId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        role: dto.role,
        active: dto.active,
        organizationId: id,
        mustChangePassword: true,
        passwordHash: await hashPassword(dto.password),
      });
      await this.audit(actor, `account.${dto.role}.created`, id, user.id);
      return publicUser(user);
    });
  }
  async updateAccount(
    actor: string,
    version: number,
    org: string,
    id: string,
    change: { details?: UserDetailsDto; active?: boolean; password?: string },
  ) {
    return this.write(actor, version, async () => {
      await this.organization(org);
      if (!/^[a-f\d]{24}$/i.test(id))
        throw new NotFoundException('Account not found');
      const user = await this.users
        .findOne({
          _id: id,
          organizationId: org,
          role: { $in: ['admin', 'user'] },
        })
        .select('+sessionVersion');
      if (!user) throw new NotFoundException('Account not found');
      if (
        user.role === 'admin' &&
        !user.invitationPending &&
        user.active &&
        (change.active === false ||
          (change.details && change.details.role !== 'admin')) &&
        (await this.users.countDocuments({
          organizationId: org,
          role: 'admin',
          active: true,
          invitationPending: { $ne: true },
        })) <= 1
      )
        throw new ConflictException(
          'The last active administrator must be preserved',
        );
      if (change.details) {
        if (change.details.firstName !== undefined)
          user.firstName = change.details.firstName;
        if (change.details.lastName !== undefined)
          user.lastName = change.details.lastName;
        if (user.invitationPending && user.email !== change.details.email) {
          user.invitationHash = undefined;
          user.invitationExpiresAt = undefined;
          user.invitationDelivery = 'not_sent';
        }
        if (user.email !== change.details.email) {
          user.resetHash = undefined;
          user.resetExpiresAt = undefined;
        }
        user.email = change.details.email;
        user.role = change.details.role;
      }
      if (change.active !== undefined) {
        if (!change.active) {
          user.resetHash = undefined;
          user.resetExpiresAt = undefined;
        }
        user.active = change.active;
        if (!change.active && user.invitationPending) {
          user.invitationHash = undefined;
          user.invitationExpiresAt = undefined;
          user.invitationDelivery = 'not_sent';
        }
      }
      if (change.password) {
        user.resetHash = undefined;
        user.resetExpiresAt = undefined;
        user.passwordHash = await hashPassword(change.password);
        user.mustChangePassword = true;
      }
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
      await this.audit(
        actor,
        change.password
          ? 'password.reset.initiated'
          : 'account.update.requested',
        org,
        user.id,
      );
      await user.save();
      await this.audit(
        actor,
        change.password
          ? 'password.reset.completed'
          : change.active !== undefined
            ? change.active
              ? 'account.activated'
              : 'account.deactivated'
            : 'account.updated',
        org,
        user.id,
      );
      if (change.password) await this.mail.passwordChanged(user.email);
      return change.password
        ? {
            message:
              'Temporary password set. Sessions invalidated; password change required at next sign-in.',
          }
        : publicUser(user);
    });
  }
  async events(actor: string, version: number, id: string, page: PageDto) {
    await this.actor(actor, version);
    await this.organization(id);
    return {
      items: await this.audits
        .find({ organizationId: id })
        .sort({ at: -1, _id: -1 })
        .skip((page.page - 1) * page.limit)
        .limit(page.limit)
        .toArray(),
      total: await this.audits.countDocuments({ organizationId: id }),
    };
  }
}
