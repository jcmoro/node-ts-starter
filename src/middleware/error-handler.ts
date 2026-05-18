import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from '../lib/logger.ts';
import { getRequestId } from '../lib/request-context.ts';

/**
 * Hono `app.onError` handler. Two paths:
 *
 *   - Thrown `HTTPException` (e.g. via `throw new HTTPException(404)`): the
 *     handler explicitly asked for a specific HTTP status. We surface it.
 *
 *   - Anything else: an *unexpected* error. We log it with full context
 *     (stack, request ID) and respond with a generic 500 — never leak the
 *     stack to the client.
 */
export function errorHandler(logger: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    const requestId = getRequestId();

    logger.error(
      {
        err,
        method: c.req.method,
        path: c.req.path,
      },
      'unhandled error',
    );

    return c.json(
      {
        error: 'internal server error',
        ...(requestId ? { requestId } : {}),
      },
      500,
    );
  };
}
