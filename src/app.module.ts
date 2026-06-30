import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration, { DatabaseConfig } from './config/configuration';
import { MessagingModule } from './messaging/messaging.module';
import { ThreatsModule } from './threats/threats.module';
import { HealthModule } from './health/health.module';
import { Threat } from './threats/entities/threat.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
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
})
export class AppModule {}
