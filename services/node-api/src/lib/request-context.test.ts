import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRequestId, runWithRequestContext } from './request-context.ts';

describe('request-context', () => {
  it('returns undefined outside any context', () => {
    assert.equal(getRequestId(), undefined);
  });

  it('exposes the requestId inside runWithRequestContext', () => {
    runWithRequestContext({ requestId: 'r-1' }, () => {
      assert.equal(getRequestId(), 'r-1');
    });
  });

  it('propagates through await boundaries', async () => {
    await runWithRequestContext({ requestId: 'r-2' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(getRequestId(), 'r-2');
    });
  });

  it('isolates contexts between parallel runs', async () => {
    const observed: string[] = [];

    await Promise.all([
      runWithRequestContext({ requestId: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observed.push(getRequestId() ?? '');
      }),
      runWithRequestContext({ requestId: 'b' }, async () => {
        observed.push(getRequestId() ?? '');
      }),
    ]);

    assert.deepEqual(observed.sort(), ['a', 'b']);
  });
});
