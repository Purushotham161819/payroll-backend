import type { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

export function configureSecurity(
  app: NestExpressApplication,
  store?: session.Store,
) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      'SESSION_SECRET must contain at least 32 random characters',
    );
  const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';
  if (new URL(origin).origin !== origin)
    throw new Error('FRONTEND_ORIGIN must be an exact origin');
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
    throw new Error('Production requires HTTPS');
  if (process.env.TRUST_PROXY_HOPS) {
    const hops = Number(process.env.TRUST_PROXY_HOPS);
    if (!Number.isSafeInteger(hops) || hops < 1)
      throw new Error('TRUST_PROXY_HOPS must be a positive integer');
    app.set('trust proxy', hops);
  }
  app.use(helmet());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Payroll-Request'],
  });
  app.use(
    '/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Too many login attempts. Try again later.' },
    }),
  );
  app.use(
    session({
      name: 'payroll.sid',
      secret,
      resave: false,
      saveUninitialized: false,
      store:
        store ??
        MongoStore.create({
          clientPromise: Promise.resolve(
            app.get<Connection>(getConnectionToken()).getClient(),
          ),
          collectionName: 'auth_sessions',
        }),
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
}
