import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Enable OnApplicationShutdown so the SQS consumer drains gracefully.
  app.enableShutdownHooks();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = app.get(ConfigService);
  const { port } = config.getOrThrow<AppConfig>('app');

  await app.listen(port);
  Logger.log(`Threat Triage Engine listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
