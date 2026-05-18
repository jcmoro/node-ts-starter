import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { err, ok, tryCatch } from './result.ts';

describe('ok', () => {
  it('wraps a value in a success Result', () => {
    const r = ok(42);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 42);
  });

  it('preserves the value type (object)', () => {
    const r = ok({ id: 'abc', count: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { id: 'abc', count: 1 });
  });
});

describe('err', () => {
  it('wraps an error in a failure Result', () => {
    const e = new Error('boom');
    const r = err(e);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, e);
  });

  it('accepts non-Error error shapes', () => {
    const r = err({ kind: 'not_found', id: '123' } as const);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'not_found');
  });
});

describe('tryCatch', () => {
  it('returns ok when the function resolves', async () => {
    const r = await tryCatch(async () => 'value');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 'value');
  });

  it('returns err when the function throws an Error', async () => {
    const r = await tryCatch(async () => {
      throw new Error('fail');
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.error instanceof Error);
      assert.equal(r.error.message, 'fail');
    }
  });

  it('wraps non-Error thrown values into an Error', async () => {
    const r = await tryCatch(async () => {
      throw 'just a string';
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.error instanceof Error);
      assert.equal(r.error.message, 'just a string');
    }
  });

  it('propagates the resolved value through the Promise chain', async () => {
    const r = await tryCatch(async () => {
      const a = await Promise.resolve(1);
      const b = await Promise.resolve(2);
      return a + b;
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 3);
  });
});
