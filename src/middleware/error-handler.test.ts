import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createTestLogger } from '../lib/logger.ts';
import { errorHandler } from './error-handler.ts';
import { requestIdMiddleware } from './request-id.ts';

function buildApp() {
  const logger = createTestLogger();
  const app = new Hono();
  app.use(requestIdMiddleware());

  app.get('/boom', () => {
    throw new Error('something blew up');
  });

  app.get('/http-error', () => {
    throw new HTTPException(418, { message: 'teapot' });
  });

  app.onError(errorHandler(logger));
  return app;
}

describe('errorHandler', () => {
  it('returns 500 with a generic body for unexpected throws', async () => {
    const app = buildApp();
    const res = await app.request('/boom');

    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string; requestId?: string };
    assert.equal(body.error, 'internal server error');
  });

  it('includes the requestId in the response body', async () => {
    const app = buildApp();
    const res = await app.request('/boom', {
      headers: { 'X-Request-Id': 'test-id-abc' },
    });

    const body = (await res.json()) as { error: string; requestId?: string };
    assert.equal(body.requestId, 'test-id-abc');
  });

  it('does NOT leak the original error message to the client', async () => {
    const app = buildApp();
    const res = await app.request('/boom');
    const text = JSON.stringify(await res.json());
    assert.equal(text.includes('something blew up'), false);
  });

  it('honours HTTPException status and message', async () => {
    const app = buildApp();
    const res = await app.request('/http-error');

    assert.equal(res.status, 418);
    const text = await res.text();
    assert.equal(text, 'teapot');
  });
});
