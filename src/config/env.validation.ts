/**
 * Lightweight, dependency-free environment validation executed by
 * `ConfigModule` at startup. It fails fast on malformed numeric values and, in
 * production, enforces that the critical messaging/database settings are
 * present so the service never boots into a silently-broken state.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  const numericVars = [
    'PORT',
    'DB_PORT',
    'SQS_WAIT_TIME_SECONDS',
    'SQS_MAX_MESSAGES',
    'SQS_VISIBILITY_TIMEOUT',
  ];
  for (const name of numericVars) {
    const raw = config[name];
    if (raw !== undefined && raw !== '' && Number.isNaN(Number(raw))) {
      errors.push(`${name} must be a number (received "${String(raw)}")`);
    }
  }

  const waitTime = Number(config.SQS_WAIT_TIME_SECONDS);
  if (!Number.isNaN(waitTime) && (waitTime < 0 || waitTime > 20)) {
    errors.push('SQS_WAIT_TIME_SECONDS must be between 0 and 20');
  }

  const maxMessages = Number(config.SQS_MAX_MESSAGES);
  if (!Number.isNaN(maxMessages) && (maxMessages < 1 || maxMessages > 10)) {
    errors.push('SQS_MAX_MESSAGES must be between 1 and 10');
  }

  if (config.NODE_ENV === 'production') {
    const required = [
      'DB_HOST',
      'DB_NAME',
      'THREAT_ANALYSIS_QUEUE_URL',
      'BLOCK_IP_COMMAND_TOPIC_ARN',
    ];
    for (const name of required) {
      if (!config[name]) {
        errors.push(`${name} is required in production`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n - ${errors.join('\n - ')}`,
    );
  }

  return config;
}
