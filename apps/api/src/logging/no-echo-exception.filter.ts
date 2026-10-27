import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { describeError } from './describe-error.js';

const logger = new Logger('http');

/** The status an error from Express's own middleware carries (`http-errors`: 413, 415, …). */
function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  const status =
    typeof exception === 'object' && exception !== null && 'status' in exception
      ? exception.status
      : undefined;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
}

/**
 * What Nest answers outside tRPC: the status and its name (`BAD_REQUEST`), nothing else.
 * Nest's default quotes the error: a body that is not JSON came back as `Unexpected token 'K',
 * …"lastName": Kvapilová}" is not valid JSON`, an unknown path as `Cannot GET /…`; an unexpected
 * error was logged with its message and stack, and the message of a failed query holds its
 * parameters. tRPC's own errors never get here, its handler answers them (`errorFormatter`).
 */
@Catch()
export class NoEchoExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = statusOf(exception);
    if (status >= 500) {
      logger.error({ msg: 'request failed', status, ...describeError(exception) });
    }
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({ statusCode: status, message: HttpStatus[status] ?? 'ERROR' });
  }
}
