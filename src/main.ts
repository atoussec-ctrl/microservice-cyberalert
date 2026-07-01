import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  setupSwagger(app);

  const config = app.get(ConfigService);
  const { port } = config.getOrThrow<AppConfig>('app');

  await app.listen(port);
  Logger.log(`Threat Triage Engine listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
