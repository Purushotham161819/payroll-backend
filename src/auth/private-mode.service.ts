import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import type { Request } from 'express';
import { EmailService, securityEmail } from './email.service';

type Challenge = {
  _id: string;
  accountId: string;
  version: number;
  purpose: string;
  generation: string;
  otpHash?: string;
  otpExpiresAt: Date;
  attempts: number;
  delivered: boolean;
  grantExpiresAt?: Date;
  purgeAt: Date;
};
type Limit = { _id: string; count?: number; availableAt?: Date; purgeAt: Date };
export type PrivateRequest = Request & {
  account: { id: string; role: string; email: string; firstName?: string };
};
const purpose = 'employee-private-mode-unlock';
const invalid =
  'The verification code is invalid, expired, already used, or unavailable. Request a new code.';

@Injectable()
export class PrivateModeService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly db: Connection,
    private readonly email: EmailService,
  ) {}
  private get challenges() {
    return this.db.collection<Challenge>('employee_private_mode_challenges');
  }
  private get limits() {
    return this.db.collection<Limit>('employee_private_mode_limits');
  }
  async onModuleInit() {
    this.seconds('PRIVATE_MODE_OTP_TTL_SECONDS', 300, 60, 600);
    this.seconds('PRIVATE_MODE_UNLOCK_SECONDS', 900, 60, 1800);
    await this.challenges.createIndex(
      { purgeAt: 1 },
      { expireAfterSeconds: 0 },
    );
    await this.limits.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
  }
  private seconds(name: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
  }
  private mac(value: string) {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException(
        'Private Mode verification is unavailable.',
      );
    return createHmac('sha256', secret).update(value).digest('hex');
  }
  private identity(req: PrivateRequest) {
    if (
      req.account?.role !== 'employee' ||
      !req.session?.userId ||
      req.account.id !== req.session.userId
    )
      throw new ForbiddenException('Employee access required.');
    return {
      id: this.mac(`${purpose}:${req.account.id}:${req.sessionID}`),
      accountId: req.account.id,
      version: req.session.sessionVersion ?? 0,
    };
  }
  async authorization(req: PrivateRequest) {
    const key = this.identity(req);
    const grant = await this.challenges.findOne(
      {
        _id: key.id,
        accountId: key.accountId,
        version: key.version,
        purpose,
        grantExpiresAt: { $gt: new Date() },
      },
      { projection: { grantExpiresAt: 1 } },
    );
    const until = Math.min(
      grant?.grantExpiresAt?.getTime() ?? 0,
      req.session.expiresAt ?? 0,
    );
    return until > Date.now() ? until : 0;
  }
  async status(req: PrivateRequest) {
    const until = await this.authorization(req);
    return { privateMode: !until, unlockedUntil: until || null, serverNow: Date.now() };
  }
  private async rate(accountId: string, action: string, maximum: number) {
    const window = 15 * 60_000,
      now = Date.now();
    const result = await this.limits.findOneAndUpdate(
      { _id: `${accountId}:${action}:${Math.floor(now / window)}` },
      {
        $inc: { count: 1 },
        $setOnInsert: { purgeAt: new Date(now + window * 2) },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if ((result?.count ?? 0) > maximum)
      throw new HttpException(
        'Too many verification requests. Try again later.',
        429,
      );
  }
  async requestCode(req: PrivateRequest) {
    const key = this.identity(req),
      now = Date.now();
    await this.rate(key.accountId, 'send', 5);
    try {
      await this.limits.findOneAndUpdate(
        {
          _id: `${key.accountId}:cooldown`,
          availableAt: { $lte: new Date(now) },
        },
        {
          $set: {
            availableAt: new Date(now + 60_000),
            purgeAt: new Date(now + 15 * 60_000),
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new HttpException(
          'Please wait 60 seconds before requesting another code.',
          429,
        );
      throw error;
    }
    const previous = await this.challenges.findOne(
      { _id: key.id },
      { projection: { otpHash: 1, generation: 1 } },
    );
    let code: string;
    do {
      code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    } while (
      previous?.otpHash ===
      this.mac(`${key.id}:${previous?.generation}:${code}`)
    );
    const generation = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      now + this.seconds('PRIVATE_MODE_OTP_TTL_SECONDS', 300, 60, 600) * 1000,
    );
    await this.challenges.updateOne(
      { _id: key.id },
      {
        $set: {
          accountId: key.accountId,
          version: key.version,
          purpose,
          generation,
          otpHash: this.mac(`${key.id}:${generation}:${code}`),
          otpExpiresAt: expiresAt,
          attempts: 0,
          delivered: false,
          grantExpiresAt: new Date(0),
          purgeAt: expiresAt,
        },
      },
      { upsert: true },
    );
    try {
      await this.email.send(
        req.account.email,
        securityEmail(
          'PayStream – Your Private Mode Verification Code',
          `Hello ${req.account.firstName ?? ''},\n\nA request was made to view your sensitive salary and payroll information in PayStream.\n\nYour one-time verification code is: ${code}\n\nEnter this code in the Employee Portal to temporarily disable Private Mode. It expires in ${Math.round((expiresAt.getTime() - now) / 60_000)} minutes and can only be used once. If you did not initiate this request, ignore this email.\n\nRegards,\nPayStream Security Team`,
        ),
      );
      const delivered = await this.challenges.updateOne(
        { _id: key.id, generation },
        { $set: { delivered: true } },
      );
      if (delivered.matchedCount !== 1)
        throw new Error('Challenge was cancelled');
    } catch {
      await this.challenges.updateOne(
        { _id: key.id, generation },
        { $unset: { otpHash: '' }, $set: { delivered: false } },
      );
      throw new ServiceUnavailableException(
        'The verification email could not be sent. Private Mode remains enabled. Try again after the cooldown.',
      );
    }
    const [name, domain] = req.account.email.split('@');
    return {
      message: 'A verification email was requested. Check your inbox.',
      maskedEmail: `${name[0] ?? ''}******${name.length > 1 ? name.at(-1) : ''}@${domain}`,
      expiresAt: expiresAt.getTime(),
      resendAt: now + 60_000,
    };
  }
  async verify(req: PrivateRequest, code: string) {
    const key = this.identity(req);
    await this.rate(key.accountId, 'verify', 20);
    const challenge = await this.challenges.findOneAndUpdate(
      {
        _id: key.id,
        accountId: key.accountId,
        version: key.version,
        purpose,
        delivered: true,
        otpHash: { $exists: true },
        otpExpiresAt: { $gt: new Date() },
        attempts: { $lt: 5 },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!challenge?.otpHash) {
      const blocked = await this.challenges.findOne(
        {
          _id: key.id,
          version: key.version,
          otpHash: { $exists: true },
          attempts: { $gte: 5 },
          otpExpiresAt: { $gt: new Date() },
        },
        { projection: { _id: 1 } },
      );
      if (blocked)
        throw new HttpException(
          'Too many incorrect codes. Request a new code after the cooldown.',
          429,
        );
      throw new BadRequestException(invalid);
    }
    const digest = this.mac(`${key.id}:${challenge.generation}:${code}`);
    if (
      !timingSafeEqual(
        Buffer.from(challenge.otpHash, 'hex'),
        Buffer.from(digest, 'hex'),
      )
    )
      throw challenge.attempts >= 5
        ? new HttpException(
            'Too many incorrect codes. Request a new code after the cooldown.',
            429,
          )
        : new BadRequestException(invalid);
    const until = Math.min(
      Date.now() +
        this.seconds('PRIVATE_MODE_UNLOCK_SECONDS', 900, 60, 1800) * 1000,
      req.session.expiresAt ?? 0,
    );
    const consumed = await this.challenges.updateOne(
      {
        _id: key.id,
        generation: challenge.generation,
        otpHash: challenge.otpHash,
        otpExpiresAt: { $gt: new Date() },
      },
      {
        $unset: { otpHash: '' },
        $set: { grantExpiresAt: new Date(until), purgeAt: new Date(until) },
      },
    );
    if (consumed.modifiedCount !== 1) throw new BadRequestException(invalid);
    return {
      privateMode: false,
      unlockedUntil: until,
      serverNow: Date.now(),
      message: 'Private Mode is temporarily disabled for this session.',
    };
  }
  async lock(req: PrivateRequest) {
    const key = this.identity(req);
    await this.challenges.updateOne(
      { _id: key.id },
      {
        $set: {
          accountId: key.accountId,
          version: key.version,
          purpose,
          generation: randomBytes(32).toString('hex'),
          otpExpiresAt: new Date(0),
          grantExpiresAt: new Date(0),
          purgeAt: new Date(Date.now() + 60_000),
          attempts: 5,
          delivered: false,
        },
        $unset: { otpHash: '' },
      },
      { upsert: true },
    );
    return {
      privateMode: true,
      unlockedUntil: null,
      message: 'Private Mode enabled.',
    };
  }
  async requireUnlocked(req: PrivateRequest) {
    if (!(await this.authorization(req)))
      throw new ForbiddenException({
        code: 'PRIVATE_MODE_REQUIRED',
        message:
          'Verify your email to view sensitive payroll information or PDFs.',
      });
  }
}
