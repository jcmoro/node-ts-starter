import type { MiddlewareHandler } from 'hono';
import { runWithRequestContext } from '../lib/request-context.ts';

const HEADER = 'x-request-id';

/**
 * Generate (or honour) a request ID per request, expose it in the response
 * `X-Request-Id` header, and propagate it through AsyncLocalStorage so that
 * any log emitted during the request — anywhere in the call tree — is
 * automatically tagged with it.
 */
export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(HEADER);
    const requestId = isValidRequestId(incoming) ? incoming : crypto.randomUUID();

    c.header(HEADER, requestId);
    c.set('requestId', requestId);

    await runWithRequestContext({ requestId }, () => next());
  };
}

/**
 * Validate that an incoming X-Request-Id is a sane, bounded string. Without
 * this an attacker could pump unlimited bytes into our log files just by
 * spamming the header.
 */
function isValidRequestId(value: string | undefined): value is string {
  if (!value) return false;
  if (value.length > 128) return false;
  // Allow common ID shapes: UUIDs, ULIDs, slug-like.
  return /^[a-zA-Z0-9_-]+$/.test(value);
}
