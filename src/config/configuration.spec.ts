import configuration from './configuration';

describe('configuration', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('falls back to defaults when env vars are unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USERNAME;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    delete process.env.DB_SYNCHRONIZE;
    delete process.env.DB_SSL;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.THREAT_ANALYSIS_QUEUE_URL;
    delete process.env.BLOCK_IP_COMMAND_TOPIC_ARN;
    delete process.env.SQS_WAIT_TIME_SECONDS;
    delete process.env.SQS_MAX_MESSAGES;
    delete process.env.SQS_VISIBILITY_TIMEOUT;
    delete process.env.SQS_POLLING_ENABLED;

    const config = configuration();

    expect(config.app).toEqual({ nodeEnv: 'development', port: 3000 });
    expect(config.database).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'threat_intelligence',
      synchronize: true,
      ssl: false,
    });
    expect(config.aws).toEqual({
      region: 'us-east-1',
      endpoint: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
    });
    expect(config.messaging).toEqual({
      threatAnalysisQueueUrl: '',
      blockIpCommandTopicArn: '',
      waitTimeSeconds: 20,
      maxMessages: 10,
      visibilityTimeoutSeconds: 60,
      pollingEnabled: true,
    });
  });

  it('falls back to defaults when env vars are blank strings', () => {
    process.env.PORT = '   ';
    process.env.DB_PORT = '';
    process.env.DB_SYNCHRONIZE = '  ';
    process.env.AWS_ENDPOINT_URL = '';
    process.env.AWS_ACCESS_KEY_ID = '';
    process.env.AWS_SECRET_ACCESS_KEY = '';

    const config = configuration();

    expect(config.app.port).toBe(3000);
    expect(config.database.port).toBe(5432);
    expect(config.database.synchronize).toBe(true);
    expect(config.aws.endpoint).toBeUndefined();
    expect(config.aws.accessKeyId).toBeUndefined();
    expect(config.aws.secretAccessKey).toBeUndefined();
  });

  it('parses valid integers and overrides', () => {
    process.env.PORT = '4000';
    process.env.DB_PORT = '6543';
    process.env.SQS_WAIT_TIME_SECONDS = '5';
    process.env.SQS_MAX_MESSAGES = '3';
    process.env.SQS_VISIBILITY_TIMEOUT = '120';

    const config = configuration();

    expect(config.app.port).toBe(4000);
    expect(config.database.port).toBe(6543);
    expect(config.messaging.waitTimeSeconds).toBe(5);
    expect(config.messaging.maxMessages).toBe(3);
    expect(config.messaging.visibilityTimeoutSeconds).toBe(120);
  });

  it('falls back to the default int when the value is not a number', () => {
    process.env.PORT = 'not-a-number';

    const config = configuration();

    expect(config.app.port).toBe(3000);
  });

  it.each(['1', 'true', 'yes', 'on', 'TRUE', 'On'])(
    'treats %s as a truthy boolean',
    (value) => {
      process.env.DB_SSL = value;
      expect(configuration().database.ssl).toBe(true);
    },
  );

  it.each(['0', 'false', 'no', 'off', 'garbage'])(
    'treats %s as a falsy boolean',
    (value) => {
      process.env.DB_SYNCHRONIZE = value;
      expect(configuration().database.synchronize).toBe(false);
    },
  );

  it('reads custom string values as-is', () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = 'db.internal';
    process.env.DB_USERNAME = 'svc';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'threats';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_ENDPOINT_URL = 'http://localstack:4566';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THREAT_ANALYSIS_QUEUE_URL = 'https://sqs/queue';
    process.env.BLOCK_IP_COMMAND_TOPIC_ARN = 'arn:aws:sns:topic';
    process.env.SQS_POLLING_ENABLED = 'false';

    const config = configuration();

    expect(config.app.nodeEnv).toBe('production');
    expect(config.database.host).toBe('db.internal');
    expect(config.database.username).toBe('svc');
    expect(config.database.password).toBe('secret');
    expect(config.database.database).toBe('threats');
    expect(config.aws.region).toBe('eu-west-1');
    expect(config.aws.endpoint).toBe('http://localstack:4566');
    expect(config.aws.accessKeyId).toBe('AKIA');
    expect(config.aws.secretAccessKey).toBe('secret-key');
    expect(config.messaging.threatAnalysisQueueUrl).toBe('https://sqs/queue');
    expect(config.messaging.blockIpCommandTopicArn).toBe('arn:aws:sns:topic');
    expect(config.messaging.pollingEnabled).toBe(false);
  });
});
