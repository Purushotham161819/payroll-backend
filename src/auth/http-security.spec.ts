import { configureSecurity } from './http-security';
import type { NestExpressApplication } from '@nestjs/platform-express';

describe('Session secret validation', () => {
  const original = process.env.SESSION_SECRET;
  afterAll(()=>{if(original===undefined) delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=original;});
  it.each([undefined,'','1234567890123456789012345678901'])('rejects missing or invalid secrets',secret=>{
    if(secret===undefined) delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=secret;
    expect(()=>configureSecurity({} as NestExpressApplication)).toThrow('SESSION_SECRET must contain at least 32 random characters');
  });
});
