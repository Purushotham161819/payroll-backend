import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { User } from './auth.schema';
import { withAccountLock } from './account-storage';
import { hashPassword } from './password-hashing';
import { EmailService, securityEmail } from './email.service';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const generic = {
  message:
    'If the account is eligible, a password reset email has been requested. Check your inbox or contact your administrator.',
};
const invalid =
  'This reset link is invalid, expired, already used, or unavailable. Request a new password reset.';
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly queue: string[] = [];
  private processing = false;
  enqueue(email: string) {
    // Respond independently of account lookup and Graph latency to prevent timing enumeration.
    if (this.queue.length < 100) {
      this.queue.push(email);
      setImmediate(() => void this.drain());
    } else this.logger.warn('password_reset_queue_full');
    return { ...generic };
  }
  private async drain() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const email = this.queue.shift()!;
        try {
          await this.request(email);
        } catch {
          this.logger.warn('password_reset_request_failed');
        }
      }
    } finally {
      this.processing = false;
    }
  }
  constructor(
    @InjectModel('AuthUser') private readonly users: Model<User>,
    private readonly mail: EmailService,
  ) {}
  private async eligible(user: User) {
    return (
      user.active &&
      !user.invitationPending &&
      (!user.organizationId ||
        !!(await this.users.db
          .collection('organizations')
          .findOne({ organizationId: user.organizationId, status: 'active' })))
    );
  }
  async request(email: string) {
    await withAccountLock(this.users, async () => {
      const user = await this.users
        .findOne({ email: email.trim().toLowerCase() })
        .select('+resetRequestedAt');
      if (
        !user ||
        !(await this.eligible(user)) ||
        (user.resetRequestedAt &&
          Date.now() - user.resetRequestedAt.getTime() < 60000)
      )
        return;
      const token = randomBytes(32).toString('base64url');
      user.resetHash = hash(token);
      user.resetExpiresAt = new Date(Date.now() + 30 * 60000);
      user.resetRequestedAt = new Date();
      await user.save();
      try {
        await this.mail.send(
          user.email,
          securityEmail(
            'Reset Your PayStream Password',
            'Use the secure link below to reset your password. It expires in 30 minutes and can be used once. If you did not request this, ignore this email.',
            (process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200') +
              '/reset-password#token=' +
              token,
          ),
        );
      } catch {
        /* Generic response; preserve token for ambiguous acceptance. */
      }
    });
    return { ...generic };
  }
  private async valid(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new BadRequestException(invalid);
    const user = await this.users.findOne({
      resetHash: hash(token),
      resetExpiresAt: { $gt: new Date() },
      active: true,
      invitationPending: { $ne: true },
    });
    if (!user || !(await this.eligible(user)))
      throw new BadRequestException(invalid);
    return user;
  }
  async inspect(token: string) {
    await this.valid(token);
    return { firstName: '' };
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
      const result = await this.users.updateOne(
        {
          _id: user._id,
          resetHash: hash(token),
          resetExpiresAt: { $gt: new Date() },
          active: true,
        },
        {
          $set: {
            passwordHash: await hashPassword(password),
            mustChangePassword: false,
          },
          $inc: { sessionVersion: 1 },
          $unset: { resetHash: '', resetExpiresAt: '' },
        },
      );
      if (result.modifiedCount !== 1) throw new BadRequestException(invalid);
      await this.mail.passwordChanged(user.email);
      return {
        message:
          'Your password has been reset. Sign in with your new password.',
      };
    });
  }
}
