import { type ArgumentsHost, BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NoEchoExceptionFilter } from './no-echo-exception.filter.js';

function host() {
  const json = vi.fn();
  const res = { headersSent: false, status: vi.fn(() => ({ json })), end: vi.fn() };
  return {
    host: { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost,
    res,
    json,
  };
}

describe('NoEchoExceptionFilter', () => {
  it('answers a 5xx by the status name only, never with its message', () => {
    const { host: h, res, json } = host();
    new NoEchoExceptionFilter().catch(new Error('Failed query: … params: Jana Horváthová'), h);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('answers a 4xx by its status name, not by what the caller sent', () => {
    const { host: h, res, json } = host();
    new NoEchoExceptionFilter().catch(new BadRequestException('Unexpected token in "Jana"'), h);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('only ends a response whose headers are already out', () => {
    const { host: h, res } = host();
    res.headersSent = true;
    new NoEchoExceptionFilter().catch(new Error('late'), h);
    expect(res.end).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
