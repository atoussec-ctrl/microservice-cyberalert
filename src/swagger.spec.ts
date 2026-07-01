import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { setupSwagger } from './swagger';

describe('setupSwagger', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({}).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('builds and mounts the OpenAPI document without throwing', () => {
    expect(() => setupSwagger(app)).not.toThrow();
  });
});
