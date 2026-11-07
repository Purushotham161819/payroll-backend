
import './environment';
import { configureOrganizationLogoBodyParser } from './organizations/organization-logo-body-parser';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureSecurity } from './auth/http-security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureOrganizationLogoBodyParser(app);
  app.enableShutdownHooks();
  configureSecurity(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();


