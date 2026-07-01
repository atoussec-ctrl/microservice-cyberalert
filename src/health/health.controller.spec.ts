import { Test } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };
  let db: { pingCheck: jest.Mock };

  beforeEach(async () => {
    health = { check: jest.fn() };
    db = { pingCheck: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: TypeOrmHealthIndicator, useValue: db },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('delegates to HealthCheckService with a database ping indicator', async () => {
    const expected = { status: 'ok', info: {}, error: {}, details: {} };
    health.check.mockImplementation(
      async (indicators: Array<() => unknown>) => {
        for (const indicator of indicators) {
          await indicator();
        }
        return expected;
      },
    );
    db.pingCheck.mockResolvedValue({ database: { status: 'up' } });

    const result = await controller.check();

    expect(result).toBe(expected);
    expect(health.check).toHaveBeenCalledTimes(1);
    expect(db.pingCheck).toHaveBeenCalledWith('database');
  });
});
