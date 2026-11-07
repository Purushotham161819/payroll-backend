import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { User } from './auth.schema';
import { InvitationMail } from './invitation-mail';
import { hashPassword } from './password-hashing';
import { withAccountLock } from './account-storage';

const invalidMessage =
  'This invitation is invalid, expired, already used, or unavailable. Contact your organization administrator for a new invitation.';
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel('AuthUser') private readonly users: Model<User>,
    private readonly mail: InvitationMail,
  ) {}
  private hours() {
    const hours = Number(process.env.INVITATION_TTL_HOURS ?? 24);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168)
      throw new Error('INVITATION_TTL_HOURS must be between 1 and 168');
    return hours;
  }
  private origin() {
    const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') ||
      !['http:', 'https:'].includes(url.protocol)
    )
      throw new Error('Invalid frontend origin');
    return origin;
  }
  // Caller holds the existing account-operation lock, including during delivery.
  async send(user: HydratedDocument<User>) {
    if (!user.invitationPending || !['admin', 'user'].includes(user.role))
      throw new ConflictException(
        'This account does not have a pending invitation',
      );
    if (
      user.invitationSentAt &&
      Date.now() - new Date(user.invitationSentAt).getTime() < 60_000
    )
      throw new ConflictException(
        'Please wait a minute before resending this invitation.',
      );
    let hours: number, origin: string;
    try {
      hours = this.hours();
      origin = this.origin();
    } catch {
      user.invitationHash = undefined;
      user.invitationExpiresAt = undefined;
      user.invitationDelivery = 'failed';
      await user.save();
      return {
        invitationSent: false,
        message:
          'User created, but the invitation could not be sent. Check email configuration and resend the invitation.',
      };
    }
    const token = randomBytes(32).toString('base64url');
    user.invitationHash = tokenHash(token);
    user.invitationExpiresAt = new Date(Date.now() + hours * 3_600_000);
    user.invitationSentAt = new Date();
    user.invitationDelivery = 'not_sent';
    await user.save();
    try {
      // Fragment prevents the bearer token from reaching HTTP access logs or Referer headers.
      await this.mail.send(
        user.email,
        user.firstName ?? '',
        user.lastName ?? '',
        `${origin}/set-password#token=${token}`,
        hours,
      );
    } catch {
      user.invitationHash = undefined;
      user.invitationExpiresAt = undefined;
      user.invitationDelivery = 'failed';
      await user.save();
      return {
        invitationSent: false,
        message:
          'User created, but the invitation could not be sent. Check email configuration and resend the invitation.',
      };
    }
    user.invitationDelivery = 'sent';
    await user.save();
    return {
      invitationSent: true,
      message:
        'Invitation request accepted by Microsoft Graph. Delivery is not yet confirmed.',
    };
  }
  private async valid(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new BadRequestException(invalidMessage);
    const user = await this.users
      .findOne({
        invitationHash: tokenHash(token),
        invitationPending: true,
        active: true,
        role: { $in: ['admin', 'user'] },
        invitationExpiresAt: { $gt: new Date() },
      })
      .select('+invitationHash +invitationExpiresAt +sessionVersion');
    if (
      !user ||
      (user.organizationId &&
        !(await this.users.db
          .collection('organizations')
          .findOne({ organizationId: user.organizationId, status: 'active' })))
    )
      throw new BadRequestException(invalidMessage);
    return user;
  }
  async inspect(token: string) {
    const user = await this.valid(token);
    return {
      firstName: user.firstName ?? '',
      message: 'Set your password to finish setting up your account.',
    };
  }
  async complete(token: string, password: string, confirmation: string) {
    if (
      password.length < 8 ||
      password.length > 128 ||
      password !== confirmation
    )
      throw new BadRequestException(
        'Passwords must match and contain 8 to 128 characters.',
      );
    return withAccountLock(this.users, async () => {
      const user = await this.valid(token);
      const passwordHash = await hashPassword(password);
      const result = await this.users.updateOne(
        {
          _id: user._id,
          organizationId: user.organizationId ?? null,
          invitationHash: tokenHash(token),
          invitationPending: true,
          active: true,
          invitationExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            passwordHash,
            invitationPending: false,
            mustChangePassword: false,
          },
          $inc: { sessionVersion: 1 },
          $unset: {
            invitationHash: '',
            invitationExpiresAt: '',
            invitationSentAt: '',
            invitationDelivery: '',
          },
        },
      );
      if (result.modifiedCount !== 1)
        throw new BadRequestException(invalidMessage);
      return {
        message: 'Your password is set. You can now sign in to PayStream.',
      };
    });
  }
}
