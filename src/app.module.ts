import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration, { DatabaseConfig } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { MessagingModule } from './messaging/messaging.module';
import { ThreatsModule } from './threats/threats.module';
import { HealthModule } from './health/health.module';
import { Threat } from './threats/entities/threat.entity';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      cache: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.getOrThrow<DatabaseConfig>('database');
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          entities: [Threat],
          synchronize: db.synchronize,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
        };
      },
    }),
    MessagingModule,
    ThreatsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
