import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CreateUserSchema,
  EmailSchema,
  NonEmptyStringSchema,
  UserIdSchema,
  newUserId,
} from './user.ts';

describe('EmailSchema', () => {
  it('accepts a valid email', () => {
    const r = EmailSchema.safeParse('jose@example.com');
    assert.equal(r.success, true);
  });

  it('rejects a string without @', () => {
    const r = EmailSchema.safeParse('not-an-email');
    assert.equal(r.success, false);
  });

  it('normalises to lowercase and trims', () => {
    const r = EmailSchema.safeParse('  Jose@Example.COM  ');
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data, 'jose@example.com');
  });
});

describe('UserIdSchema', () => {
  it('accepts a UUID v4', () => {
    const uuid = crypto.randomUUID();
    const r = UserIdSchema.safeParse(uuid);
    assert.equal(r.success, true);
  });

  it('rejects a non-UUID string', () => {
    const r = UserIdSchema.safeParse('abc');
    assert.equal(r.success, false);
  });
});

describe('NonEmptyStringSchema', () => {
  it('accepts a non-empty string', () => {
    const r = NonEmptyStringSchema.safeParse('Jose');
    assert.equal(r.success, true);
  });

  it('rejects an empty string', () => {
    const r = NonEmptyStringSchema.safeParse('');
    assert.equal(r.success, false);
  });
});

describe('CreateUserSchema', () => {
  it('parses a valid payload and brands the fields', () => {
    const r = CreateUserSchema.safeParse({
      email: 'jose@example.com',
      name: 'Jose',
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.email, 'jose@example.com');
      assert.equal(r.data.name, 'Jose');
    }
  });

  it('rejects a payload missing fields', () => {
    const r = CreateUserSchema.safeParse({ email: 'jose@example.com' });
    assert.equal(r.success, false);
  });
});

describe('newUserId', () => {
  it('returns a valid UUID', () => {
    const id = newUserId();
    const r = UserIdSchema.safeParse(id);
    assert.equal(r.success, true);
  });

  it('returns a different value each time', () => {
    assert.notEqual(newUserId(), newUserId());
  });
});
