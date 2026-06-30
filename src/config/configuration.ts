export interface AppConfig {
  nodeEnv: string;
  port: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  ssl: boolean;
}

export interface AwsConfig {
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface MessagingConfig {
  /** URL of the SQS queue subscribed to the `threat-detected` SNS topic. */
  threatAnalysisQueueUrl: string;
  /** ARN of the SNS topic used to publish `block-ip-command` events. */
  blockIpCommandTopicArn: string;
  /** Long-poll wait time, in seconds (0-20). */
  waitTimeSeconds: number;
  /** Maximum number of messages pulled per receive call (1-10). */
  maxMessages: number;
  /** Visibility timeout applied to in-flight messages, in seconds. */
  visibilityTimeoutSeconds: number;
  /** Whether the SQS consumer should start polling automatically on boot. */
  pollingEnabled: boolean;
}

export interface RootConfig {
  app: AppConfig;
  database: DatabaseConfig;
  aws: AwsConfig;
  messaging: MessagingConfig;
}

const toInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

export default (): RootConfig => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: toInt(process.env.PORT, 3000),
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: toInt(process.env.DB_PORT, 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'threat_intelligence',
    synchronize: toBool(process.env.DB_SYNCHRONIZE, true),
    ssl: toBool(process.env.DB_SSL, false),
  },
  aws: {
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL || undefined,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
  },
  messaging: {
    threatAnalysisQueueUrl: process.env.THREAT_ANALYSIS_QUEUE_URL ?? '',
    blockIpCommandTopicArn: process.env.BLOCK_IP_COMMAND_TOPIC_ARN ?? '',
    waitTimeSeconds: toInt(process.env.SQS_WAIT_TIME_SECONDS, 20),
    maxMessages: toInt(process.env.SQS_MAX_MESSAGES, 10),
    visibilityTimeoutSeconds: toInt(process.env.SQS_VISIBILITY_TIMEOUT, 60),
    pollingEnabled: toBool(process.env.SQS_POLLING_ENABLED, true),
  },
});
