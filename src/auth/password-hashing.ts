import * as argon2 from 'argon2';

// Match the existing administrator/user provisioning policy.
export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });
