import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { ApiErrorResponse } from '../dto/api-error-response';

/**
 * Catch-all exception filter. It is platform-agnostic (uses `HttpAdapterHost`
 * instead of Express/Fastify types), produces a consistent `ApiErrorResponse`
 * envelope, maps common TypeORM errors to sensible HTTP statuses, logs with the
 * right severity, and never leaks internal details for 5xx errors in
 * production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Resolve lazily: the adapter may be unavailable at construction time.
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const path = httpAdapter.getRequestUrl(request) ?? '';

    const { status, message, error } = this.resolve(exception);

    const isProduction = process.env.NODE_ENV === 'production';
    const safeMessage =
      status >= HttpStatus.INTERNAL_SERVER_ERROR && isProduction
        ? 'Internal server error'
        : message;

    const body: ApiErrorResponse = {
      statusCode: status,
      error,
      message: safeMessage,
      timestamp: new Date().toISOString(),
      path,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${status} ${error} on ${path}: ${this.stringify(message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${status} ${error} on ${path}: ${this.stringify(message)}`,
      );
    }

    httpAdapter.reply(ctx.getResponse(), body, status);
  }

  private resolve(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { status, message: response, error: exception.name };
      }
      const obj = response as Record<string, unknown>;
      return {
        status,
        message: (obj.message as string | string[]) ?? exception.message,
        error: (obj.error as string) ?? exception.name,
      };
    }

    if (exception instanceof EntityNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'Resource not found',
        error: 'Not Found',
      };
    }

    if (exception instanceof QueryFailedError) {
      // e.g. unique-constraint violations bubbling up from the DB.
      return {
        status: HttpStatus.CONFLICT,
        message: 'Database constraint violation',
        error: 'Conflict',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        exception instanceof Error ? exception.message : 'Unexpected error',
      error: 'Internal Server Error',
    };
  }

  private stringify(message: string | string[]): string {
    return Array.isArray(message) ? message.join('; ') : message;
  }
}
