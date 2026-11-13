import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isEmail } from 'class-validator';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { User } from './auth.schema';
import { UsersService } from './users.service';
import { AuthService } from './auth.service';
import { InvitationsService } from './invitations.service';
import { withAccountLock } from './account-storage';
import { hashPassword } from './password-hashing';
import { businessModel } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { linkedEmployee } from './employee-access';
import { employeeAccountAudit } from './employee-account-audit';

@Injectable()
export class EmployeeAccountsService {
  constructor(
    @InjectModel('AuthUser') private readonly users: Model<User>,
    private readonly management: UsersService,
    private readonly auth: AuthService,
    private readonly invitations: InvitationsService,
  ) {}

  private async target(
    actorId: string,
    version: number,
    id: string,
    allowManager = false,
  ) {
    const actor = allowManager
      ? await this.auth.current(actorId, version)
      : await this.management.requireAdmin(actorId, version);
    if (!['admin', 'user'].includes(actor.role))
      throw new ForbiddenException('Employee management access required.');
    if (actor.mustChangePassword)
      throw new ForbiddenException(
        'Change your temporary password before continuing.',
      );
    if (!actor.organizationId)
      throw new ForbiddenException('An organization account is required.');
    if (!/^[a-f\d]{24}$/i.test(id))
      throw new BadRequestException('Invalid employee ID.');
    const employee = await businessModel(
      this.users.db,
      Employee.name,
      EmployeeSchema,
      actor.organizationId,
    )
      .findById(id)
      .lean()
      .exec();
    if (!employee)
      throw new NotFoundException('Employee not found in this organization.');
    return { actor, employee };
  }
  async invite(
    actorId: string,
    version: number,
    id: string,
    linkPendingUserId?: string,
  ) {
    return withAccountLock(this.users, async () => {
      const { actor, employee } = await this.target(actorId, version, id);
      id = employee._id.toString();
      if ((employee.status ?? 'Active') !== 'Active')
        throw new ConflictException('Terminated employees cannot be invited.');
      const email = employee.email?.trim().toLowerCase();
      if (!email || !isEmail(email))
        throw new BadRequestException(
          'Employee email address is missing or invalid.',
        );
      let user = await this.users
        .findOne({
          organizationId: actor.organizationId,
          employeeRecordId: id,
          role: 'employee',
        })
        .select('+invitationSentAt');
      if (user && user.email !== email)
        throw new ConflictException(
          'Employee email differs from the linked account. Contact your administrator for secure account recovery.',
        );
      if (user && !user.active)
        throw new ConflictException(
          'Employee portal access is disabled. An administrator must explicitly reactivate it.',
        );
      if (
        user &&
        user.employeeLifecycleVersion !== (employee.lifecycleVersion ?? 0)
      )
        throw new ConflictException(
          'Employment has changed. An administrator must explicitly reactivate portal access.',
        );
      if (user && !user.invitationPending)
        return {
          invitationSent: false,
          alreadyActive: true,
          message: 'Employee already has an active account.',
        };
      if (!user) {
        // Email remains globally unique, as required by the existing shared login.
        const existing = await this.users.findOne({ email });
        if (existing) {
          const eligible =
            existing.organizationId === actor.organizationId &&
            existing.role === 'user' &&
            existing.active &&
            existing.invitationPending === true &&
            existing.employeeRecordId === undefined;
          if (!eligible)
            throw new ConflictException(
              'This email is already used by another login account. Active accounts, administrator accounts and accounts outside this organization cannot be converted through Send Invite. No email was sent.',
            );
          if (!linkPendingUserId)
            throw new ConflictException({
              code: 'PENDING_USER_LINK_CONFIRMATION_REQUIRED',
              pendingAccountId: existing.id,
              message:
                'This employee has an unactivated regular-user invitation in your organization. Confirm conversion to read-only employee access to replace that invitation and send a new welcome email.',
            });
          if (existing.id !== linkPendingUserId)
            throw new ConflictException(
              'The pending account has changed. Cancel and try Send Invite again.',
            );
          // Only bind a previously unlinked, unactivated user after explicit admin confirmation.
          // The atomic predicate also protects against an activation or account change in flight.
          user = await this.users
            .findOneAndUpdate(
              {
                _id: existing._id,
                email,
                organizationId: actor.organizationId,
                role: 'user',
                active: true,
                invitationPending: true,
                employeeRecordId: { $exists: false },
              },
              {
                $set: {
                  role: 'employee',
                  employeeRecordId: id,
                  employeeLifecycleVersion: employee.lifecycleVersion ?? 0,
                  firstName: employee.firstName,
                  lastName: employee.lastName,
                  mustChangePassword: false,
                  invitationDelivery: 'not_sent',
                },
                $inc: { sessionVersion: 1 },
                $unset: {
                  invitationHash: '',
                  invitationExpiresAt: '',
                  invitationSentAt: '',
                  resetHash: '',
                  resetExpiresAt: '',
                },
              },
              {
                returnDocument: 'after',
                runValidators: true,
                overwriteImmutable: true,
              },
            )
            .select('+invitationSentAt');
          if (!user)
            throw new ConflictException(
              'The pending account is no longer eligible. Cancel and try Send Invite again.',
            );
        } else if (linkPendingUserId) {
          throw new ConflictException(
            'The pending account has changed. Cancel and try Send Invite again.',
          );
        }
      }
      if (!user) {
        try {
          user = await this.users.create({
            organizationId: actor.organizationId,
            employeeRecordId: id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email,
            role: 'employee',
            active: true,
            employeeLifecycleVersion: employee.lifecycleVersion ?? 0,
            invitationPending: true,
            invitationDelivery: 'not_sent',
            passwordHash: await hashPassword(
              randomBytes(32).toString('base64url'),
            ),
          });
        } catch (error) {
          if ((error as { code?: number }).code === 11000)
            throw new ConflictException('An employee account already exists.');
          throw error;
        }
      }
      return this.invitations.send(user, actorId);
    });
  }
  async status(actorId: string, version: number, id: string, active: boolean) {
    return withAccountLock(this.users, async () => {
      const { actor, employee } = await this.target(
        actorId,
        version,
        id,
        !active,
      );
      id = employee._id.toString();
      const user = await this.users
        .findOne({
          organizationId: actor.organizationId,
          employeeRecordId: id,
          role: 'employee',
        })
        .select('+invitationSentAt');
      if (!user) throw new NotFoundException('Employee account not found.');
      if (
        user.active === active &&
        (!active ||
          user.employeeLifecycleVersion === (employee.lifecycleVersion ?? 0))
      )
        throw new ConflictException(
          active
            ? 'Employee portal access is already enabled.'
            : 'Employee portal access is already revoked.',
        );
      if (active) {
        try {
          await linkedEmployee(this.users.db, {
            ...user.toObject(),
            employeeLifecycleVersion: employee.lifecycleVersion ?? 0,
          });
        } catch {
          throw new ConflictException(
            'Employee access cannot be restored. Verify active employment and the linked login email.',
          );
        }
      }
      const at = new Date();
      await this.users.updateOne(
        { _id: user._id },
        {
          $set: {
            active,
            ...(!user.portalInvitationSentAt &&
            user.invitationDelivery === 'sent' &&
            user.invitationSentAt
              ? { portalInvitationSentAt: user.invitationSentAt }
              : {}),
            ...(user.invitationPending
              ? { invitationCancelledAt: user.invitationCancelledAt ?? at }
              : {}),
            ...(active ? { accessRestoredAt: at } : { accessRevokedAt: at }),
            ...(active
              ? { employeeLifecycleVersion: employee.lifecycleVersion ?? 0 }
              : {}),
          },
          $inc: { sessionVersion: 1 },
          ...employeeAccountAudit(
            user.role,
            [
              active ? 'access.restored' : 'access.revoked',
              ...(user.invitationPending && !user.invitationCancelledAt
                ? ['invitation.cancelled']
                : []),
            ],
            actorId,
            at,
          ),
          $unset: {
            invitationHash: '',
            invitationExpiresAt: '',
            invitationSentAt: '',
            resetHash: '',
            resetExpiresAt: '',
          },
        },
      );
      return {
        message: active
          ? 'Employee portal access enabled. Resend the invitation if setup is pending.'
          : 'Employee portal access disabled.',
      };
    });
  }
  async permissions(actorId: string, version: number, id: string) {
    const { actor, employee } = await this.target(actorId, version, id, true);
    const user = await this.users
      .findOne({
        organizationId: actor.organizationId,
        employeeRecordId: employee._id.toString(),
        role: 'employee',
      })
      .select('+invitationSentAt +invitationExpiresAt +portalAudit')
      .lean()
      .exec();
    const base = {
      employeeName:
        `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
      email: employee.email,
      canRestore: false,
      canRevoke: false,
      canCancel: false,
      canResend: false,
    };
    if (!user)
      return {
        ...base,
        accountStatus: 'Not Invited',
        invitationStatus: 'Not Invited',
        passwordSetupStatus: 'Not Yet Activated',
        accessStatus: 'Not Invited',
        loginStatus: 'Not Available',
        invitationSentAt: null,
        invitationAcceptedAt: null,
        accountActivatedAt: null,
        passwordSetupAt: null,
        lastLoginAt: null,
        accessRevokedAt: null,
        accessRestoredAt: null,
        invitationCancelledAt: null,
        audit: [],
      };
    const employeeActive = (employee.status ?? 'Active') === 'Active';
    const emailMatches = user.email === employee.email?.trim().toLowerCase();
    const lifecycleMatches =
      user.employeeLifecycleVersion === (employee.lifecycleVersion ?? 0);
    const eligible = employeeActive && emailMatches && lifecycleMatches;
    const pending = user.invitationPending === true;
    const expired =
      !!user.invitationExpiresAt &&
      new Date(user.invitationExpiresAt).getTime() <= Date.now();
    const invitationStatus = !pending
      ? 'Invitation Accepted'
      : user.invitationCancelledAt
        ? 'Invitation Cancelled'
        : user.invitationDelivery === 'failed'
          ? 'Delivery Failed'
          : expired
            ? 'Invitation Expired'
            : user.invitationDelivery === 'sent'
              ? 'Invitation Sent'
              : 'Invitation Pending';
    const actorIds = [
      ...new Set(
        (user.portalAudit ?? [])
          .map((e) => e.actorId)
          .filter((value) => /^[a-f\d]{24}$/i.test(value)),
      ),
    ];
    const actors = actorIds.length
      ? await this.users
          .find({
            _id: { $in: actorIds },
            organizationId: actor.organizationId,
          })
          .select('firstName lastName email')
          .lean()
          .exec()
      : [];
    const names = new Map(
      actors.map((a) => [
        String(a._id),
        `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email,
      ]),
    );
    return {
      ...base,
      accountEmail: user.email,
      accountStatus: !user.active
        ? 'Access Revoked'
        : !eligible
          ? 'Access Blocked'
          : pending
            ? 'Invitation Pending'
            : 'Account Active',
      invitationStatus,
      passwordSetupStatus: pending ? 'Password Setup Pending' : 'Completed',
      accessStatus: !user.active
        ? 'Access Revoked'
        : !eligible
          ? 'Access Blocked'
          : 'Enabled',
      accessReason: !employeeActive
        ? 'Employment is terminated.'
        : !emailMatches
          ? 'Employee email differs from the linked login. Secure account recovery is required.'
          : !lifecycleMatches
            ? 'Employment has changed. An administrator must restore access explicitly.'
            : null,
      loginStatus: user.lastLoginAt
        ? 'Recorded'
        : pending || user.accountActivatedAt
          ? 'Never Logged In'
          : 'Not Available',
      invitationSentAt:
        user.portalInvitationSentAt ??
        (user.invitationDelivery === 'sent'
          ? (user.invitationSentAt ?? null)
          : null),
      invitationAcceptedAt: user.invitationAcceptedAt ?? null,
      passwordSetupAt: user.passwordSetupAt ?? null,
      accountActivatedAt: user.accountActivatedAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
      invitationCancelledAt: user.invitationCancelledAt ?? null,
      accessRevokedAt: user.accessRevokedAt ?? null,
      accessRestoredAt: user.accessRestoredAt ?? null,
      canRevoke: user.active,
      canRestore:
        actor.role === 'admin' &&
        employeeActive &&
        emailMatches &&
        (!user.active || !lifecycleMatches),
      canCancel: pending && !user.invitationCancelledAt,
      canResend: user.active && eligible && pending,
      audit: (user.portalAudit ?? [])
        .slice()
        .reverse()
        .map((e) => ({
          action: e.action,
          at: e.at,
          actorId: e.actorId,
          actorName: names.get(e.actorId) ?? e.actorId,
        })),
    };
  }
  async cancelInvitation(actorId: string, version: number, id: string) {
    return withAccountLock(this.users, async () => {
      const { actor, employee } = await this.target(actorId, version, id, true);
      const user = await this.users.findOne({
        organizationId: actor.organizationId,
        employeeRecordId: employee._id.toString(),
        role: 'employee',
      });
      if (!user) throw new NotFoundException('Employee account not found.');
      if (!user.invitationPending || user.invitationCancelledAt)
        throw new ConflictException(
          'Only a pending invitation can be cancelled.',
        );
      const at = new Date();
      const result = await this.users.updateOne(
        { _id: user._id, invitationPending: true },
        {
          $set: { invitationCancelledAt: at, invitationDelivery: 'not_sent' },
          $inc: { sessionVersion: 1 },
          $unset: {
            invitationHash: '',
            invitationExpiresAt: '',
            resetHash: '',
            resetExpiresAt: '',
          },
          ...employeeAccountAudit(
            user.role,
            ['invitation.cancelled'],
            actorId,
            at,
          ),
        },
      );
      if (result.modifiedCount !== 1)
        throw new ConflictException(
          'The invitation is no longer pending. Refresh and try again.',
        );
      return {
        message:
          'Invitation cancelled. The previous setup link no longer works.',
      };
    });
  }
  async resendInvitation(actorId: string, version: number, id: string) {
    return withAccountLock(this.users, async () => {
      const { actor, employee } = await this.target(actorId, version, id, true);
      const user = await this.users
        .findOne({
          organizationId: actor.organizationId,
          employeeRecordId: employee._id.toString(),
          role: 'employee',
        })
        .select('+invitationSentAt');
      if (!user)
        throw new NotFoundException(
          'Employee account not found. Use Send Invite from the employee directory.',
        );
      if (!user.active || !user.invitationPending)
        throw new ConflictException(
          'Only an enabled account with pending password setup can be invited again.',
        );
      try {
        await linkedEmployee(this.users.db, user);
      } catch {
        throw new ConflictException(
          'Invitation cannot be resent. Verify active employment, the linked email and authorized access.',
        );
      }
      return this.invitations.send(user, actorId);
    });
  }
  async profile(id: string, version: number) {
    await this.auth.current(id, version);
    const user = await this.users.findById(id);
    if (!user || user.role !== 'employee')
      throw new ForbiddenException('Employee access required.');
    return linkedEmployee(this.users.db, user);
  }
}
