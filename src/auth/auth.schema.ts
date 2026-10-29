import { Schema } from 'mongoose';

export interface User {
  email: string;
  passwordHash: string;
  active: boolean;
  role: string;
  sessionVersion: number;
}
export const UserSchema = new Schema<User>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    sessionVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);
