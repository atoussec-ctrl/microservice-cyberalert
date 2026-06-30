import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let reply: jest.Mock;
  let getRequestUrl: jest.Mock;

  const buildHost = () =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({}),
      }),
    }) as never;

  const lastReply = () => reply.mock.calls[reply.mock.calls.length - 1];

  beforeEach(() => {
    reply = jest.fn();
    getRequestUrl = jest.fn().mockReturnValue('/threats');
    const adapterHost = {
      httpAdapter: { reply, getRequestUrl },
    } as unknown as HttpAdapterHost;
    filter = new AllExceptionsFilter(adapterHost);
    delete process.env.NODE_ENV;
  });

  it('formats an HttpException into the standardized envelope', () => {
    filter.catch(new NotFoundException('Threat X not found'), buildHost());
    const [, body, status] = lastReply();
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Threat X not found',
      path: '/threats',
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('preserves validation message arrays from BadRequestException', () => {
    filter.catch(
      new BadRequestException(['sourceIp must be an ip address']),
      buildHost(),
    );
    const [, body, status] = lastReply();
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.message).toEqual(['sourceIp must be an ip address']);
  });

  it('maps a TypeORM EntityNotFoundError to 404', () => {
    filter.catch(new EntityNotFoundError('Threat', {}), buildHost());
    const [, , status] = lastReply();
    expect(status).toBe(HttpStatus.NOT_FOUND);
  });

  it('maps a TypeORM QueryFailedError to 409 Conflict', () => {
    filter.catch(
      new QueryFailedError('INSERT ...', [], new Error('duplicate key')),
      buildHost(),
    );
    const [, body, status] = lastReply();
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body.error).toBe('Conflict');
  });

  it('returns a 500 with the real message outside production', () => {
    filter.catch(new Error('boom: secret detail'), buildHost());
    const [, body, status] = lastReply();
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('boom: secret detail');
  });

  it('sanitizes 5xx messages in production', () => {
    process.env.NODE_ENV = 'production';
    filter.catch(new Error('boom: secret detail'), buildHost());
    const [, body] = lastReply();
    expect(body.message).toBe('Internal server error');
  });
});
