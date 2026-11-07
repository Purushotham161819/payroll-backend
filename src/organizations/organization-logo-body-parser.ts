import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';

export function configureOrganizationLogoBodyParser(app: NestExpressApplication) {
  const parseLogo = json({ limit: '3mb' });
  // Nest detects existing parsers by middleware name. Mounting jsonParser directly
  // on this route makes Nest skip its normal JSON parser for every other route.
  app.use('/settings/organization-profile/logo', function organizationLogoJson(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    return parseLogo(req, res, next);
  });
}
