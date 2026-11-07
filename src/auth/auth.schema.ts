import { Schema } from 'mongoose';

export interface User {
  resetHash?: string;
  resetExpiresAt?: Date;
  resetRequestedAt?: Date;
  firstName?: string;
  lastName?: string;
  invitationPending?: boolean;
  invitationDelivery?: 'sent' | 'failed' | 'not_sent';
  invitationHash?: string;
  invitationExpiresAt?: Date;
  invitationSentAt?: Date;
  email: string;
  passwordHash: string;
  active: boolean;
  role: string;
  sessionVersion: number;
  organizationId?: string;
  mustChangePassword?: boolean;
}
export const UserSchema = new Schema<User>(
  {
    resetHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    resetRequestedAt: { type: Date, select: false },
    firstName: { type: String, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, maxlength: 100 },
    invitationPending: { type: Boolean, default: false },
    invitationDelivery: { type: String, enum: ['sent', 'failed', 'not_sent'] },
    invitationHash: { type: String, select: false },
    invitationExpiresAt: { type: Date, select: false },
    invitationSentAt: { type: Date, select: false },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    role: {
      type: String,
      enum: ['admin', 'user', 'super_admin'],
      default: 'user',
    },
    organizationId: { type: String, immutable: true, index: true },
    mustChangePassword: { type: Boolean, default: false },
    sessionVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);
